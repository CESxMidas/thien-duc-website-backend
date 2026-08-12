import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContentStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { json } from '../common/prisma-json';
import {
  assertContentStatusTransition,
  initialContentStatus,
} from '../common/content-approval';
import { CATEGORY_IN_USE_CODE } from './news-category-slug';
import { CreateNewsCategoryDto } from './dto/create-news-category.dto';
import { CreateNewsPostDto } from './dto/create-news-post.dto';
import { UpdateNewsCategoryDto } from './dto/update-news-category.dto';
import { UpdateNewsPostDto } from './dto/update-news-post.dto';

const UNIQUE_CONSTRAINT = 'P2002';

@Injectable()
export class NewsService {
  constructor(private readonly prisma: PrismaService) {}

  // ----- Bài viết -----

  findAll(publishedOnly = false) {
    return this.prisma.newsPost.findMany({
      where: publishedOnly ? { status: ContentStatus.PUBLISHED } : undefined,
      orderBy: this.listOrderBy(publishedOnly),
      include: { category: true },
    });
  }

  /**
   * Một trang bài đã đăng, kèm metadata điều hướng.
   *
   * Đếm và lấy trang chạy trong **một** transaction để tổng số bài và nội dung
   * trang luôn thuộc cùng một ảnh chụp dữ liệu — nếu không, một bài được đăng
   * xen giữa hai truy vấn sẽ làm `totalPages` lệch với thứ tự trang đang trả.
   */
  async findAllPaginated(page: number, limit: number, categorySlug?: string) {
    // Slug chuyên mục không tồn tại KHÔNG phải lỗi: `category: { slug }` chỉ
    // đơn giản không khớp bài nào → trang rỗng, `totalPages = 0`. Frontend tự
    // quyết định hiện trạng thái trống hay `notFound()`; ném 500 ở đây thì một
    // URL cũ bị đổi slug sẽ làm sập trang thay vì hiện danh sách rỗng.
    const where: Prisma.NewsPostWhereInput = {
      status: ContentStatus.PUBLISHED,
      ...(categorySlug ? { category: { slug: categorySlug } } : {}),
    };

    const [totalItems, items] = await this.prisma.$transaction([
      this.prisma.newsPost.count({ where }),
      this.prisma.newsPost.findMany({
        where,
        orderBy: this.listOrderBy(true),
        include: { category: true },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    return {
      items,
      page,
      limit,
      totalItems,
      totalPages,
      // Trang vượt quá cuối danh sách trả mảng rỗng chứ không lỗi — client tự
      // quyết định chuyển hướng hay báo trống. `hasNextPage` vẫn phải là false
      // ở đó, nên so với `totalPages` chứ không so với số phần tử trả về.
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  /**
   * Bài nháp chưa có `publishedAt` nên màn admin sắp theo `updatedAt`, không thì
   * bị dồn xuống cuối danh sách.
   *
   * Khoá phụ `id desc` là **bắt buộc** cho danh sách công khai: nhiều bài nhập
   * cùng đợt có `publishedAt` trùng nhau tới từng giây, mà `ORDER BY` một khoá
   * không phân định được thì Postgres được phép trả thứ tự khác nhau giữa các
   * lần chạy — phân trang sẽ lặp bài ở trang này và nuốt bài ở trang kia.
   */
  private listOrderBy(
    publishedOnly: boolean,
  ): Prisma.NewsPostOrderByWithRelationInput[] {
    return publishedOnly
      ? [{ publishedAt: 'desc' }, { id: 'desc' }]
      : [{ updatedAt: 'desc' }, { id: 'desc' }];
  }

  /**
   * `publishedOnly` bắt buộc bật ở route công khai — nếu không, người ngoài
   * đoán đúng slug là đọc được cả bài nháp lẫn bài đang chờ duyệt.
   */
  async findBySlug(slug: string, publishedOnly = false) {
    const post = await this.prisma.newsPost.findUnique({
      where: { slug },
      include: { category: true },
    });
    if (!post || (publishedOnly && post.status !== ContentStatus.PUBLISHED)) {
      throw new NotFoundException('Không tìm thấy bài viết');
    }
    return post;
  }

  async create(dto: CreateNewsPostDto, actorRole?: string) {
    const { eventDate, scheduledAt, ...rest } = dto;
    // SUPER_ADMIN bỏ qua luồng duyệt: bài đăng ngay (PUBLISHED) kèm publishedAt
    // để trang tin công khai (sắp theo publishedAt) hiển thị đúng thứ tự. Vai
    // trò khác lưu nháp như cũ.
    const status = initialContentStatus(actorRole);
    try {
      return await this.prisma.newsPost.create({
        data: {
          ...rest,
          title: json(rest.title),
          summary: json(rest.summary),
          content: json(rest.content),
          eventDate: eventDate ? new Date(eventDate) : undefined,
          scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
          status,
          publishedAt:
            status === ContentStatus.PUBLISHED ? new Date() : undefined,
        } satisfies Prisma.NewsPostUncheckedCreateInput,
      });
    } catch (error) {
      this.rethrowSlugConflict(error, 'Slug bài viết đã tồn tại');
    }
  }

  async update(slug: string, dto: UpdateNewsPostDto) {
    const post = await this.findBySlug(slug);
    const { eventDate, scheduledAt, ...rest } = dto;
    try {
      return await this.prisma.newsPost.update({
        where: { id: post.id },
        data: {
          ...rest,
          title: json(rest.title),
          summary: json(rest.summary),
          content: json(rest.content),
          eventDate: eventDate ? new Date(eventDate) : undefined,
          scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
        } satisfies Prisma.NewsPostUncheckedUpdateInput,
      });
    } catch (error) {
      this.rethrowSlugConflict(error, 'Slug bài viết đã tồn tại');
    }
  }

  async updateStatus(slug: string, status: ContentStatus, actorRole?: string) {
    const post = await this.findBySlug(slug);
    // EDITOR chỉ được gửi duyệt (DRAFT → PENDING); ADMIN trở lên đặt tùy ý.
    assertContentStatusTransition(actorRole, post.status, status);
    // Giữ nguyên publishedAt của lần đăng đầu tiên khi bài được đăng lại,
    // để thứ tự hiển thị ngoài trang tin không nhảy lung tung sau mỗi lần sửa.
    const publishedAt =
      status === ContentStatus.PUBLISHED && !post.publishedAt
        ? new Date()
        : post.publishedAt;
    return this.prisma.newsPost.update({
      where: { id: post.id },
      data: { status, publishedAt },
    });
  }

  async remove(slug: string) {
    const post = await this.findBySlug(slug);
    await this.prisma.newsPost.delete({ where: { id: post.id } });
    return { deleted: true };
  }

  // ----- Chuyên mục -----

  /**
   * Đếm bài theo chuyên mục, tách bài **đã đăng** khỏi **tổng số**.
   *
   * Hai con số trả lời hai câu khác nhau: `publishedCount` quyết định chuyên
   * mục có hiện trên website không; `totalCount` quyết định có xoá được không.
   *
   * Dùng MỘT `groupBy` cho toàn bộ bảng thay vì đếm theo từng chuyên mục —
   * tổng cộng 2 truy vấn cho cả danh sách, không N+1. Prisma không cho hai
   * `_count` cùng một quan hệ với hai bộ lọc khác nhau, nên `include._count`
   * không giải được bài toán này.
   *
   * `(category_id, status, published_at)` — chỉ mục đã có — phục vụ đúng nhóm
   * `(category_id, status)` ở đây bằng hai cột dẫn đầu. Không cần index mới.
   */
  private async countPostsByCategory() {
    const rows = await this.prisma.newsPost.groupBy({
      by: ['categoryId', 'status'],
      _count: { _all: true },
    });

    const counts = new Map<string, { published: number; total: number }>();
    for (const row of rows) {
      // Bài chưa phân loại (`categoryId = null`) không thuộc chuyên mục nào.
      if (!row.categoryId) continue;
      const entry = counts.get(row.categoryId) ?? { published: 0, total: 0 };
      entry.total += row._count._all;
      if (row.status === ContentStatus.PUBLISHED) {
        entry.published += row._count._all;
      }
      counts.set(row.categoryId, entry);
    }
    return counts;
  }

  /**
   * Danh sách chuyên mục kèm số đếm.
   *
   * `includeTotal = false` (mặc định, dùng cho route CÔNG KHAI) chỉ trả
   * `publishedCount`. Website cần biết chuyên mục có bài đã đăng hay không để
   * ẩn chuyên mục rỗng khỏi chip; nó **không** được biết công ty đang có bao
   * nhiêu bài nháp. Bản cũ trả `_count.posts` gộp mọi trạng thái trên một route
   * không cần đăng nhập — bất kỳ ai cũng đếm được số bài chưa xuất bản.
   */
  async findAllCategories(includeTotal = false) {
    const [categories, counts] = await Promise.all([
      this.prisma.newsCategory.findMany({
        orderBy: [{ order: 'asc' }, { slug: 'asc' }],
      }),
      this.countPostsByCategory(),
    ]);

    return categories.map((category) => {
      const count = counts.get(category.id) ?? { published: 0, total: 0 };
      return {
        id: category.id,
        slug: category.slug,
        name: category.name,
        order: category.order,
        publishedCount: count.published,
        ...(includeTotal ? { totalCount: count.total } : {}),
      };
    });
  }

  async createCategory(dto: CreateNewsCategoryDto) {
    try {
      return await this.prisma.newsCategory.create({
        data: {
          ...dto,
          name: json(dto.name),
        } satisfies Prisma.NewsCategoryUncheckedCreateInput,
      });
    } catch (error) {
      this.rethrowSlugConflict(error, 'Slug chuyên mục đã tồn tại');
    }
  }

  async findCategoryBySlug(slug: string) {
    const category = await this.prisma.newsCategory.findUnique({
      where: { slug },
    });
    if (!category) throw new NotFoundException('Không tìm thấy chuyên mục');
    return category;
  }

  async updateCategory(slug: string, dto: UpdateNewsCategoryDto) {
    const category = await this.findCategoryBySlug(slug);
    try {
      return await this.prisma.newsCategory.update({
        where: { id: category.id },
        data: {
          ...dto,
          name: json(dto.name),
        } satisfies Prisma.NewsCategoryUncheckedUpdateInput,
      });
    } catch (error) {
      this.rethrowSlugConflict(error, 'Slug chuyên mục đã tồn tại');
    }
  }

  /**
   * Xóa chuyên mục — **chặn nếu còn bài**.
   *
   * Database vẫn giữ `onDelete: SetNull` làm lưới an toàn cuối, nhưng API từ
   * chối trước: `SetNull` gỡ nhãn hàng loạt bài **âm thầm và không có đường
   * lùi**. Xóa nhầm một chuyên mục 11 bài là 11 bài mất phân loại, không Undo,
   * và URL chuyên mục đang được lập chỉ mục thành 404 ngay lập tức.
   *
   * Đếm **mọi trạng thái**, không riêng bài đã đăng: bài nháp cũng là công sức
   * biên tập, và nó sẽ được xuất bản sau.
   *
   * Trả 409 kèm mã máy đọc được `CATEGORY_IN_USE` + số bài trong `details` để
   * Admin dựng được câu thông báo cụ thể thay vì "có lỗi xảy ra".
   */
  async removeCategory(slug: string) {
    const category = await this.findCategoryBySlug(slug);
    const totalCount = await this.prisma.newsPost.count({
      where: { categoryId: category.id },
    });

    if (totalCount > 0) {
      throw new ConflictException({
        error: CATEGORY_IN_USE_CODE,
        message: `Chuyên mục đang được ${totalCount} bài viết sử dụng. Hãy chuyển hoặc gỡ các bài đó trước khi xóa chuyên mục.`,
        totalCount,
      });
    }

    await this.prisma.newsCategory.delete({ where: { id: category.id } });
    return { deleted: true };
  }

  private rethrowSlugConflict(error: unknown, message: string): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_CONSTRAINT
    ) {
      throw new ConflictException(message);
    }
    throw error as Error;
  }
}
