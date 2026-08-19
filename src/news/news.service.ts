import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContentStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { json } from '../common/prisma-json';
import { assertContentStatusTransition } from '../common/content-approval';
import { assertContentEditAllowed } from '../common/content-editing';
import { isPubliclyVisible, publiclyVisibleWhere } from '../common/publication';
import { CATEGORY_IN_USE_CODE } from './news-category-slug';
import { CreateNewsCategoryDto } from './dto/create-news-category.dto';
import { CreateNewsPostDto } from './dto/create-news-post.dto';
import { UpdateNewsCategoryDto } from './dto/update-news-category.dto';
import { UpdateNewsPostDto } from './dto/update-news-post.dto';

const UNIQUE_CONSTRAINT = 'P2002';

/**
 * `scheduledAt` phải bị xoá khi đổi trạng thái **thủ công** sang PUBLISHED hoặc
 * DRAFT — trả `null` để xoá, `undefined` để không đụng tới cột.
 *
 * Vì sao cần: `NewsSchedulerService` khớp `status <> 'PUBLISHED' AND
 * scheduled_at <= NOW()`. Một bài từng lên lịch rồi được ADMIN gỡ về nháp vẫn
 * giữ nguyên `scheduled_at` ở quá khứ, nên nó khớp lại điều kiện đó và **tự
 * đăng lại** trong vòng 5 phút — đúng thứ mà thao tác "Trả về nháp" muốn ngăn.
 *
 * PENDING cố ý KHÔNG xoá: theo mô hình đã duyệt, "đã lên lịch" chính là
 * `PENDING` + `scheduledAt`. Xoá ở đây sẽ huỷ lịch một cách âm thầm mỗi lần
 * ADMIN chuyển bài về hàng chờ duyệt.
 */
function clearedSchedule(next: ContentStatus): null | undefined {
  return next === ContentStatus.PUBLISHED || next === ContentStatus.DRAFT
    ? null
    : undefined;
}

/** Lịch phải cách hiện tại ít nhất chừng này — dưới ngưỡng thì dùng "Đăng ngay". */
export const MIN_SCHEDULE_LEAD_MS = 60_000;

/** Trần 2 năm — chủ yếu để bắt lỗi gõ nhầm năm, thứ hay xảy ra nhất. */
export const MAX_SCHEDULE_HORIZON_MS = 2 * 365 * 24 * 60 * 60 * 1000;

/**
 * Bài đã **thật sự** ra công khai bao giờ chưa?
 *
 * Nhờ bất biến `scheduledAt != null ⇒ publishedAt = scheduledAt`, `publishedAt`
 * nằm ở **tương lai** có nghĩa duy nhất: đây là một lịch chưa tới hạn, nội dung
 * chưa từng hiển thị cho ai. `publishedAt` trong quá khứ thì ngược lại — hoặc
 * bài từng đăng thật, hoặc lịch đã tới hạn nên Batch 2 đã cho nó ra công khai.
 *
 * Đây là thứ phân biệt "huỷ một lịch chưa xảy ra" (xoá sạch dấu vết) với "gỡ
 * một nội dung đã công khai" (giữ lại mốc lịch sử).
 */
function hasBeenPublic(post: { publishedAt: Date | null }, now: Date): boolean {
  return (
    post.publishedAt !== null && post.publishedAt.getTime() <= now.getTime()
  );
}

/** Hình dạng tối thiểu để xét trạng thái lịch của một bài. */
type SchedulableState = {
  status: ContentStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
};

/**
 * Bản ghi có đang giữ một **lịch tương lai hợp lệ** không?
 *
 * Đây là thứ phân biệt hai bản ghi trông na ná nhau vì cùng có `publishedAt`
 * khác NULL:
 *
 * - **Lịch đang chờ**: `PENDING`, `scheduledAt` ở tương lai, và `publishedAt`
 *   **đúng bằng** `scheduledAt` — tức mốc đó do chính lệnh đặt lịch ghi ra, là
 *   *dự định*, chưa bao giờ thành sự thật. Đổi lịch được.
 * - **Lịch sử xuất bản thật**: mọi trường hợp còn lại có `publishedAt`. Bài này
 *   từng ra công khai, mốc đó là *sự kiện đã xảy ra*. Không được ghi đè.
 *
 * Bốn điều kiện đều cần thiết. Bỏ `status === PENDING` thì một bài nháp mang
 * lịch dị dạng sẽ được coi là lịch hợp lệ; bỏ phép so bằng thì một bài từng
 * đăng năm 2020 rồi bị gán lịch sẽ mất mốc 2020.
 */
function isActiveFutureSchedule(post: SchedulableState, now: Date): boolean {
  return (
    post.status === ContentStatus.PENDING &&
    post.scheduledAt !== null &&
    post.publishedAt !== null &&
    post.scheduledAt.getTime() > now.getTime() &&
    post.publishedAt.getTime() === post.scheduledAt.getTime()
  );
}

/**
 * Bài đã có **lịch sử xuất bản thật** chưa? Có `publishedAt`, và mốc đó không
 * phải là dự định của một lịch tương lai đang chờ.
 */
function hasHistoricalPublication(post: SchedulableState, now: Date): boolean {
  return post.publishedAt !== null && !isActiveFutureSchedule(post, now);
}

/**
 * **EDITOR có được sửa NỘI DUNG bài này không?** (Vị từ riêng của News, ghép vào
 * bậc thang vai trò dùng chung ở `assertContentEditAllowed`.)
 *
 * Cho phép đúng hai trạng thái — nội dung còn thật sự đang trong khâu biên tập:
 *
 * - **A. Nháp chưa từng công khai**: `DRAFT` + `publishedAt = NULL`.
 * - **B. Đang chờ duyệt, chưa được hẹn giờ**: `PENDING` + không mốc nào. Cố ý
 *   vẫn mở: bắt EDITOR nhờ ADMIN cho từng lỗi chính tả trong lúc bài còn nằm ở
 *   hàng chờ là siết quá tay, vì chưa có ai duyệt gì để mà phá vỡ.
 *
 * Chặn mọi tổ hợp còn lại, trong đó ba trường hợp là lý do batch này tồn tại:
 *
 * - **Đã lên lịch (chưa tới hạn)** và **lịch đã tới hạn nhưng reconciler chưa
 *   chạy**: đây là bản ADMIN đã uỷ quyền cho một lần đăng. Sửa nó là đổi nội
 *   dung sẽ tự ra công khai — đúng lỗ hổng 07:59.
 * - **Nháp TỪNG đăng** (`DRAFT` + `publishedAt` lịch sử): `status` một mình
 *   nói sai. Bài đã ra ngoài, đã được index, có thể đăng lại chỉ bằng một cú
 *   bấm. Không được "hồi sinh" quyền sửa của EDITOR chỉ vì trạng thái là DRAFT.
 *
 * ## Không cần đồng hồ — và đó là điểm mạnh
 *
 * Nhờ bất biến `scheduledAt != null ⇒ publishedAt = scheduledAt` của lệnh đặt
 * lịch, cả "lịch tương lai" lẫn "lịch đã tới hạn" đều có `publishedAt != NULL`.
 * Nên chỉ cần *sự tồn tại* của mốc, không cần so sánh với `now`: bất biến
 * §12 (lịch đã đặt thì EDITOR không sửa được) đúng ở cả ba mốc thời gian —
 * trước hạn, đúng hạn, sau hạn mà cron chưa chạy — và không lệ thuộc đồng hồ
 * của tiến trình nào. Vế `scheduledAt === null` ở nhánh PENDING vì thế là lớp
 * chốt thứ hai, dùng cho dữ liệu dị dạng thiếu `publishedAt`.
 */
function editorMayEditNews(post: SchedulableState): boolean {
  // Có mốc công khai (dù là lịch sử thật hay lịch tương lai đã hẹn) ⇒ nội dung
  // đã qua ranh giới duyệt/xuất bản. Hết quyền của EDITOR.
  if (post.publishedAt !== null) return false;
  if (post.status === ContentStatus.DRAFT) return true;
  return post.status === ContentStatus.PENDING && post.scheduledAt === null;
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
      editorMayEditNews(post),
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
        publishedAt: this.publishedAtFor(post, status, now),
        scheduledAt: clearedSchedule(status),
      },
    });
  }

  /**
   * `publishedAt` cho một lần đổi trạng thái thủ công.
   *
   * Ba nhánh, và nhánh giữa là thứ Batch 3 bắt buộc phải thêm:
   *
   * - **Đăng ngay một bài đang hẹn lịch chưa tới hạn.** Lệnh đặt lịch đã ghi
   *   `publishedAt = scheduledAt` ở **tương lai**. Giữ nguyên giá trị đó thì bài
   *   vừa bấm đăng lại mang mốc công khai nằm ở ngày mai: danh sách công khai
   *   (sắp theo `publishedAt desc`) đẩy nó lên đầu sai chỗ, sitemap khai
   *   `lastModified` ở tương lai, và JSON-LD nói bài xuất bản vào một ngày chưa
   *   đến. Bấm "Đăng ngay" nghĩa là công khai **bây giờ**, nên mốc phải là bây giờ.
   * - **Đăng một bài chưa từng có mốc nào** → `now`, như trước.
   * - **Đăng lại một bài từng công khai thật** → giữ mốc lịch sử, đúng hành vi
   *   đã có từ trước (khoá bởi `news.service.spec.ts`): thứ tự trang tin không
   *   được nhảy lung tung sau mỗi lần sửa rồi đăng lại.
   *
   * Với DRAFT: xoá `publishedAt` **chỉ khi** nó nằm ở tương lai — tức bài chưa
   * từng công khai, mốc đó chỉ là ý định chứ không phải lịch sử. Bài đã thật sự
   * công khai (kể cả bài tới hạn mà reconciler chưa chạm tới, vốn đã hiển thị
   * qua vị từ của Batch 2) giữ nguyên mốc: nó **đã** ra ngoài, xoá đi là xoá mất
   * sự thật đó.
   */
  private publishedAtFor(
    post: { publishedAt: Date | null },
    next: ContentStatus,
    now: Date,
  ): Date | null | undefined {
    if (next === ContentStatus.PUBLISHED) {
      return hasBeenPublic(post, now) ? post.publishedAt : now;
    }
    if (next === ContentStatus.DRAFT) {
      return hasBeenPublic(post, now) ? post.publishedAt : null;
    }
    // PENDING: không đụng tới mốc công khai.
    return post.publishedAt;
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
    if (hasHistoricalPublication(post, now)) {
      throw new ConflictException(
        'Bài viết này đã từng được đăng nên không đặt lịch đăng lại được.',
      );
    }

    const leadMs = scheduledAt.getTime() - now.getTime();
    if (leadMs < MIN_SCHEDULE_LEAD_MS) {
      throw new BadRequestException(
        'Thời điểm đăng phải ở tương lai, cách hiện tại ít nhất 1 phút. Dùng "Đăng ngay" nếu muốn đăng lúc này.',
      );
    }
    if (leadMs > MAX_SCHEDULE_HORIZON_MS) {
      throw new BadRequestException(
        'Thời điểm đăng quá xa (tối đa 2 năm). Hãy kiểm tra lại năm.',
      );
    }

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
    if (!isActiveFutureSchedule(post, now)) {
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
