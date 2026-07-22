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
      // Bài nháp chưa có publishedAt nên sắp theo updatedAt ở màn admin để
      // không bị dồn xuống cuối danh sách.
      orderBy: publishedOnly ? { publishedAt: 'desc' } : { updatedAt: 'desc' },
      include: { category: true },
    });
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

  findAllCategories() {
    return this.prisma.newsCategory.findMany({
      orderBy: [{ order: 'asc' }, { slug: 'asc' }],
      include: { _count: { select: { posts: true } } },
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

  /** Bài viết thuộc chuyên mục bị xóa sẽ có `categoryId = null` (onDelete: SetNull). */
  async removeCategory(slug: string) {
    const category = await this.findCategoryBySlug(slug);
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
