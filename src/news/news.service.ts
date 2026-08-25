import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContentStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { json } from '../common/prisma-json';
import { assertContentStatusTransition } from '../common/content-approval';
import { assertContentEditAllowed } from '../common/content-editing';
import {
  assertScheduleWindow,
  MAX_SCHEDULE_HORIZON_MS,
  MIN_SCHEDULE_LEAD_MS,
} from '../common/schedule-window';
import { isPubliclyVisible, publiclyVisibleWhere } from '../common/publication';
import {
  clearedSchedule,
  editorMayEditScheduled,
  hasHistoricalPublication,
  isActiveFutureSchedule,
  publishedAtFor,
  type ScheduleState,
} from '../common/publication-schedule';
import { CATEGORY_IN_USE_CODE } from './news-category-slug';
import { CreateNewsCategoryDto } from './dto/create-news-category.dto';
import { CreateNewsPostDto } from './dto/create-news-post.dto';
import { UpdateNewsCategoryDto } from './dto/update-news-category.dto';
import { UpdateNewsPostDto } from './dto/update-news-post.dto';

const UNIQUE_CONSTRAINT = 'P2002';

/**
 * Hai ngưỡng của cửa sổ hẹn giờ nay nằm ở `common/schedule-window.ts` vì dự án
 * (Batch 9) dùng đúng luật này. Re-export để mọi import sẵn có — kể cả
 * `news-schedule-command.service.spec.ts` — không phải đổi đường dẫn.
 */
export { MAX_SCHEDULE_HORIZON_MS, MIN_SCHEDULE_LEAD_MS };

/**
 * Hình dạng tối thiểu để xét trạng thái lịch của một bài.
 *
 * `NewsPost` gọi cột bậc thang duyệt là **`status`**, trong khi các vị từ dùng
 * chung ở `common/publication-schedule.ts` nhận `contentStatus` (tên của
 * `Project`, model duy nhất có thêm một cột `status` mang nghĩa khác). Đổi tên
 * đi qua đúng một hàm chuyển có kiểu chặt (`toScheduleState`) thay vì chép lại
 * luật — giống hệt cách `pages.service.ts` làm.
 *
 * Vì sao không chép: phép so `publishedAt === scheduledAt` để phân biệt một
 * *dự định* chưa xảy ra với *lịch sử xuất bản thật* là chỗ tinh tế nhất của cả
 * cơ chế hẹn giờ. Mỗi bản sao là một cơ hội để hai module trả lời khác nhau cho
 * cùng một câu hỏi.
 */
type NewsPublicationState = {
  status: ContentStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
};

/** Đưa bài viết về hình dạng chung mà các vị từ lịch nhận vào. */
function toScheduleState(post: NewsPublicationState): ScheduleState {
  return {
    contentStatus: post.status,
    scheduledAt: post.scheduledAt,
    publishedAt: post.publishedAt,
  };
}

/** Thông điệp 403 khi EDITOR sửa bài đã qua ranh giới duyệt/xuất bản. */
const EDIT_DENIED_MESSAGE =
  'Bài viết đã được lên lịch hoặc đã xuất bản nên biên tập viên không sửa được nội dung. Hãy nhờ quản trị viên.';

@Injectable()
export class NewsService {
  constructor(private readonly prisma: PrismaService) {}

  // ----- Bài viết -----

  /**
   * `publishedOnly` = true cho website công khai — lọc theo luật hiển thị dùng
   * chung (`publiclyVisibleWhere`), nên bài đã tới hạn lên lịch xuất hiện ngay
   * cả khi reconciler chưa kịp đổi `status`. Admin (false) vẫn thấy mọi bài.
   */
  findAll(publishedOnly = false) {
    return this.prisma.newsPost.findMany({
      where: publishedOnly ? publiclyVisibleWhere(new Date()) : undefined,
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
    // MỘT `now` cho cả `count` lẫn `findMany`. Gọi `new Date()` hai lần có thể
    // rơi vào hai phía của đúng giây đáo hạn: tổng số bài đếm được một đằng,
    // nội dung trang trả về một nẻo.
    const now = new Date();
    const where: Prisma.NewsPostWhereInput = {
      ...publiclyVisibleWhere(now),
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
   *
   * Bài chưa tới hạn lên lịch ném **đúng** `NotFoundException` như bài nháp:
   * không mã lỗi riêng, không "sắp đăng lúc…", không lộ `scheduledAt`. Người
   * ngoài không được phân biệt "không tồn tại" với "sắp ra mắt".
   */
  async findBySlug(slug: string, publishedOnly = false) {
    const post = await this.prisma.newsPost.findUnique({
      where: { slug },
      include: { category: true },
    });
    if (!post || (publishedOnly && !isPubliclyVisible(post, new Date()))) {
      throw new NotFoundException('Không tìm thấy bài viết');
    }
    return post;
  }

  /**
   * Tạo bài mới — **luôn** ở trạng thái nháp, với MỌI vai trò.
   *
   * Trước Batch 5, SUPER_ADMIN tạo bài là bài ra công khai ngay (`PUBLISHED` +
   * `publishedAt = now`) theo lối "bỏ qua luồng duyệt". Cách đó gộp hai thứ
   * khác hẳn nhau vào một: **được quyền đăng** và **đăng ngay bây giờ**. Hệ quả
   * là SUPER_ADMIN mất hẳn khả năng hẹn giờ cho bài của chính mình: bài vừa
   * sinh ra đã công khai, nên `schedulePublication` từ chối 409 ("đang được
   * đăng công khai"); gỡ về nháp cũng không cứu được vì `publishedAt` lúc đó đã
   * là lịch sử thật, và lệnh đặt lịch chỉ nhận nội dung CHƯA từng công khai.
   *
   * Nay việc công khai chỉ xảy ra qua **lệnh tường minh** — `PATCH :slug/status`
   * (đăng ngay / gửi duyệt) hoặc `PATCH :slug/schedule` (hẹn giờ). Tạo nội dung
   * không còn ngầm mang nghĩa "đăng". Quyền hạn KHÔNG đổi: SUPER_ADMIN vẫn đăng
   * thẳng `DRAFT → PUBLISHED` được ngay sau đó (xem `assertContentStatusTransition`),
   * chỉ là phải nói ra ý định đó.
   *
   * Đổi ngay tại đây chứ không đổi `initialContentStatus`: helper ấy còn được
   * Projects, Pages và Cooperation dùng chung, mà ba module đó chưa có luồng
   * đặt lịch nên không có lý do gì để đổi hành vi của chúng trong batch này.
   *
   * Chỉ ảnh hưởng bài TẠO MỚI từ đây trở đi — không đụng tới bài đã có.
   */
  async create(dto: CreateNewsPostDto) {
    const { eventDate, ...rest } = dto;
    try {
      return await this.prisma.newsPost.create({
        data: {
          ...rest,
          title: json(rest.title),
          summary: json(rest.summary),
          content: json(rest.content),
          eventDate: eventDate ? new Date(eventDate) : undefined,
          // Ba cột xuất bản do SERVER đặt, ghi SAU `...rest` nên payload không
          // chèn được vào. `forbidNonWhitelisted` đã chặn field lạ từ tầng
          // ValidationPipe; ghi tường minh ở đây là lớp chốt thứ hai, và cũng
          // là cách nói rõ trạng thái xuất phát của mọi bài mới.
          //
          // Không mốc công khai, không lịch — bài chưa từng hiển thị cho ai.
          // Đây chính là điều kiện để `schedulePublication` chấp nhận hẹn giờ.
          status: ContentStatus.DRAFT,
          publishedAt: null,
          scheduledAt: null,
        } satisfies Prisma.NewsPostUncheckedCreateInput,
      });
    } catch (error) {
      this.rethrowSlugConflict(error, 'Slug bài viết đã tồn tại');
    }
  }

  /**
   * Sửa nội dung bài viết.
   *
   * Thứ tự BẮT BUỘC: nạp bản ghi hiện tại → chốt quyền theo trạng thái đã lưu →
   * mới ghi. Vai trò lấy từ token đã xác thực (controller truyền vào), không bao
   * giờ từ payload — DTO nội dung không có, và không được có, field vai trò.
   */
  async update(slug: string, dto: UpdateNewsPostDto, actorRole?: string) {
    const post = await this.findBySlug(slug);
    assertContentEditAllowed(
      actorRole,
      editorMayEditScheduled(toScheduleState(post)),
      EDIT_DENIED_MESSAGE,
    );
    const { eventDate, ...rest } = dto;
    try {
      return await this.prisma.newsPost.update({
        where: { id: post.id },
        data: {
          ...rest,
          title: json(rest.title),
          summary: json(rest.summary),
          content: json(rest.content),
          eventDate: eventDate ? new Date(eventDate) : undefined,
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
    const now = new Date();
    return this.prisma.newsPost.update({
      where: { id: post.id },
      data: {
        status,
        publishedAt: publishedAtFor(post, status, now),
        // `clearedSchedule` xoá `scheduledAt` khi về PUBLISHED/DRAFT. Với News
        // đây còn là lớp chặn tự-đăng-lại: `NewsSchedulerService` khớp
        // `status <> 'PUBLISHED' AND scheduled_at <= NOW()`, nên một bài từng
        // lên lịch rồi được ADMIN gỡ về nháp mà vẫn giữ `scheduled_at` quá khứ
        // sẽ khớp lại điều kiện đó và tự đăng lại trong vòng 5 phút — đúng thứ
        // thao tác "Trả về nháp" muốn ngăn.
        scheduledAt: clearedSchedule(status),
      },
    });
  }

  /**
   * Đặt (hoặc đổi) lịch đăng cho một bài — lệnh riêng, chốt ADMIN+ ở controller.
   *
   * Ghi **nguyên tử ba cột** trong một câu UPDATE:
   *
   * ```
   * status      = PENDING
   * scheduledAt = mốc yêu cầu
   * publishedAt = mốc yêu cầu      ← bất biến D
   * ```
   *
   * Vì sao `publishedAt` phải ghi **ngay bây giờ** chứ không đợi reconciler:
   * Batch 2 cho một bài PENDING đã tới hạn ra công khai *trước khi* cron chạy.
   * Nếu lúc đó `publishedAt` còn NULL thì bài xuất hiện với thứ tự sai (Postgres
   * xếp NULL lên đầu ở `ORDER BY ... DESC`), tụt xuống đáy kết quả tìm kiếm
   * (`NULLS LAST`), và sitemap không có `lastModified`. Mốc phải sẵn sàng từ
   * trước thời điểm nội dung có thể hiển thị.
   *
   * Vì sao trạng thái lưu là `PENDING` chứ không phải một enum `SCHEDULED` mới:
   * PENDING vừa đúng nghĩa (đã qua uỷ quyền của ADMIN, đang chờ), vừa **fail
   * safe** — mọi truy vấn cũ chỉ lọc `status = 'PUBLISHED'` mà ta lỡ bỏ sót đều
   * tự động giấu bài này đi. Rủi ro của việc quên là "hiện muộn", không phải
   * "rò rỉ sớm".
   */
  async schedulePublication(slug: string, scheduledAtIso: string) {
    const post = await this.findBySlug(slug);
    // MỘT `now` cho cả kiểm tra lẫn ghi — dùng hai mốc khác nhau thì một lịch
    // sát ngưỡng có thể qua được validate rồi ghi xuống ở trạng thái không hợp lệ.
    const now = new Date();
    const scheduledAt = new Date(scheduledAtIso);

    // Đọc lại trạng thái hiện tại rồi mới quyết định: hai ADMIN thao tác song
    // song thì lệnh đến sau vẫn thấy kết quả của lệnh đến trước.
    if (post.status === ContentStatus.PUBLISHED) {
      // Không có versioning nội dung: một slug là một hàng, đang phục vụ một URL
      // công khai. Đặt lịch cho nó chỉ có hai cách hiểu, cả hai đều đánh lừa
      // người dùng — hoặc nội dung mới lên ngay lập tức (lịch vô nghĩa), hoặc
      // URL đang được index biến mất tới giờ hẹn.
      throw new ConflictException(
        'Bài viết đang được đăng công khai nên không đặt lịch được.',
      );
    }

    // Bài TỪNG công khai thì không hẹn giờ lại được ở v1, kể cả khi đã gỡ về
    // nháp. Ghi lịch mới sẽ ghi đè `publishedAt` — mà `publishedAt` ở dự án này
    // luôn có nghĩa là **lần công khai ĐẦU TIÊN** (Batch 1 và Batch 2 đều giữ
    // nguyên mốc đó qua mọi lần đăng lại). Ghi đè nó là âm thầm định nghĩa lại
    // field thành "lần đăng gần nhất".
    //
    // Đăng lại theo lịch là một nghiệp vụ khác — nó kéo theo một loạt câu hỏi
    // chưa ai trả lời: bài có nhảy lên đầu trang tin không, `datePublished`
    // trong JSON-LD giữ mốc cũ hay mốc mới, sitemap đổi `lastModified` thế nào,
    // xếp hạng tìm kiếm dùng mốc nào, và lịch sử cũ có lấy lại được không.
    // Schema hiện không có bảng phiên bản/lịch sử để trả lời. Không trả lời
    // ngầm bằng một câu UPDATE.
    if (hasHistoricalPublication(toScheduleState(post), now)) {
      throw new ConflictException(
        'Bài viết này đã từng được đăng nên không đặt lịch đăng lại được.',
      );
    }

    assertScheduleWindow(scheduledAt, now);

    return this.prisma.newsPost.update({
      where: { id: post.id },
      data: {
        status: ContentStatus.PENDING,
        scheduledAt,
        publishedAt: scheduledAt,
      },
    });
  }

  /**
   * Huỷ lịch đăng — đưa bài về trạng thái nháp sạch sẽ.
   *
   * **Chỉ áp dụng cho lịch CHƯA tới hạn.** Nếu `scheduledAt <= now` thì theo vị
   * từ của Batch 2, bài **đã đang hiển thị công khai** rồi, dù `status` còn là
   * PENDING vì reconciler chưa chạy. Lúc đó thao tác không còn là "huỷ một việc
   * chưa xảy ra" mà là **gỡ nội dung đang công khai** — một hành động khác hẳn,
   * đã có nút riêng ("Trả về nháp"), và có hệ quả khác với `publishedAt`. Gộp
   * hai thứ vào một nút sẽ âm thầm xoá mất mốc lịch sử của một bài từng ra ngoài.
   *
   * Trạng thái sau khi huỷ:
   * ```
   * status      = DRAFT
   * scheduledAt = NULL
   * publishedAt = NULL     ← bài chưa từng công khai nên mốc đó chỉ là ý định
   * ```
   */
  async cancelScheduledPublication(slug: string) {
    const post = await this.findBySlug(slug);
    const now = new Date();

    if (post.scheduledAt === null) {
      throw new ConflictException('Bài viết này không có lịch đăng nào.');
    }
    if (post.scheduledAt.getTime() <= now.getTime()) {
      throw new ConflictException(
        'Đã qua giờ đăng theo lịch nên bài đang hiển thị công khai. Dùng "Trả về nháp" để gỡ bài xuống.',
      );
    }
    // Còn lại: `scheduledAt` ở tương lai nhưng bản ghi KHÔNG phải một lịch hợp
    // lệ — bài từng công khai và bị gán thêm lịch, hoặc tổ hợp dị dạng từ dữ
    // liệu cũ. Nhánh xoá bên dưới sẽ xoá `publishedAt`, mà ở đây mốc đó là lịch
    // sử thật. Từ chối thay vì xoá lịch sử.
    if (!isActiveFutureSchedule(toScheduleState(post), now)) {
      throw new ConflictException(
        'Bài viết này đã từng được đăng nên không huỷ lịch theo cách này được. Dùng "Trả về nháp" để gỡ bài xuống.',
      );
    }

    return this.prisma.newsPost.update({
      where: { id: post.id },
      data: {
        status: ContentStatus.DRAFT,
        scheduledAt: null,
        // Lịch hợp lệ chưa tới hạn ⇒ `publishedAt` (= scheduledAt) nằm ở tương
        // lai và chưa bao giờ là sự thật. Xoá để bài về đúng trạng thái nháp sạch.
        publishedAt: null,
      },
    });
  }

  async remove(slug: string) {
    const post = await this.findBySlug(slug);
    await this.prisma.newsPost.delete({ where: { id: post.id } });
    return { deleted: true };
  }

  // ----- Chuyên mục -----

  /**
   * Đếm bài theo chuyên mục, tách bài **hiển thị công khai** khỏi **tổng số**.
   *
   * Hai con số trả lời hai câu khác nhau: `publishedCount` quyết định chuyên
   * mục có hiện trên website không; `totalCount` quyết định có xoá được không.
   *
   * **Vì sao hai `groupBy` chứ không phải một.** Bản cũ gom một lượt theo
   * `[categoryId, status]` rồi cộng nhánh `PUBLISHED` trong JS — làm được vì
   * "đã đăng" khi đó đúng bằng một giá trị enum. Từ batch này, "công khai" là
   * một **biểu thức** (`PUBLISHED` hoặc `PENDING` đã tới hạn), mà `groupBy` của
   * Prisma không nhóm được theo biểu thức. Hai lượt đếm có `where` riêng vừa
   * diễn đạt đúng luật, vừa dùng lại nguyên `publiclyVisibleWhere` thay vì chép
   * luật hiển thị vào JS — chép là cách chắc chắn nhất để hai nơi lệch nhau.
   *
   * Vẫn **2 truy vấn cố định** cho toàn bộ danh sách, không phụ thuộc số chuyên
   * mục — không N+1. Chạy song song vì độc lập nhau.
   *
   * Chỉ mục `(category_id, status, published_at)` đã có phục vụ cả hai lượt qua
   * hai cột dẫn đầu; nhánh lịch thêm được `news_posts_scheduled_at_idx` (partial)
   * đỡ. Không cần index mới.
   */
  private async countPostsByCategory(now: Date) {
    const [totalRows, visibleRows] = await Promise.all([
      this.prisma.newsPost.groupBy({
        by: ['categoryId'],
        _count: { _all: true },
      }),
      this.prisma.newsPost.groupBy({
        by: ['categoryId'],
        where: publiclyVisibleWhere(now),
        _count: { _all: true },
      }),
    ]);

    const counts = new Map<string, { published: number; total: number }>();
    const bump = (
      categoryId: string | null,
      key: 'published' | 'total',
      amount: number,
    ) => {
      // Bài chưa phân loại (`categoryId = null`) không thuộc chuyên mục nào.
      if (!categoryId) return;
      const entry = counts.get(categoryId) ?? { published: 0, total: 0 };
      entry[key] += amount;
      counts.set(categoryId, entry);
    };

    for (const row of totalRows) bump(row.categoryId, 'total', row._count._all);
    for (const row of visibleRows) {
      bump(row.categoryId, 'published', row._count._all);
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
   *
   * `publishedCount` đếm theo **hiển thị hiệu dụng** ở cả hai route, kể cả route
   * Admin: nó trả lời "chuyên mục này đang có gì hiện trên website?", và câu trả
   * lời đó phải như nhau dù ai hỏi. Bài đã tới hạn lên lịch được tính ngay,
   * không đợi reconciler; bài hẹn tương lai thì không. Riêng `totalCount` (chỉ
   * Admin) vẫn đếm mọi trạng thái vì nó phục vụ câu hỏi khác: có xoá được không.
   */
  async findAllCategories(includeTotal = false) {
    const [categories, counts] = await Promise.all([
      this.prisma.newsCategory.findMany({
        orderBy: [{ order: 'asc' }, { slug: 'asc' }],
      }),
      this.countPostsByCategory(new Date()),
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
