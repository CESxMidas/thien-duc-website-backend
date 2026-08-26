import { ContentStatus, Prisma } from '../../generated/prisma/client';

/**
 * **Luật hiển thị công khai của nội dung có lên lịch — nguồn sự thật duy nhất.**
 *
 * Một bài được công khai khi:
 *
 * ```
 * status = PUBLISHED
 * HOẶC (status = PENDING AND scheduled_at IS NOT NULL AND scheduled_at <= now)
 * ```
 *
 * Nhánh thứ hai là lý do module này tồn tại. Trước đây bài đã lên lịch chỉ công
 * khai **sau khi** `NewsSchedulerService` đổi được `status` thành `PUBLISHED`.
 * Trên Render Free, backend ngủ sau 15 phút không traffic — với một website
 * doanh nghiệp ít lượt truy cập thì ngủ là trạng thái *bình thường*, nên lượt
 * cron lúc 08:00 có thể không bao giờ chạy. Đánh giá điều kiện **lúc truy vấn**
 * làm tính đúng đắn hết phụ thuộc vào cron: request đầu tiên sau giờ hẹn đã
 * thấy bài, kể cả khi tiến trình vừa mới thức dậy.
 *
 * ## Vì sao nhánh lịch BẮT BUỘC phải kèm `status = PENDING`
 *
 * Cách viết ngắn hơn `status = PUBLISHED OR scheduled_at <= now` là **sai và
 * nguy hiểm**: một hàng dị dạng `DRAFT` + `scheduled_at` ở quá khứ (dữ liệu cũ,
 * hoặc lỗi tương lai) sẽ lọt ra công khai. Ràng buộc `PENDING` biến trạng thái
 * lưu trữ thành lưới an toàn: nội dung chỉ ra ngoài khi nó đã **thật sự đi qua
 * luồng duyệt**. Bỏ sót một chỗ nào đó thì hậu quả là "hiện muộn", không phải
 * "rò rỉ sớm".
 *
 * ## Đồng hồ
 *
 * Mốc so sánh là `Date` của tiến trình Node, do lời gọi truyền vào — KHÔNG phải
 * `NOW()` của Postgres, vì `where` của Prisma chỉ nhận giá trị JS. Viết lại mọi
 * truy vấn News thành `$queryRaw` chỉ để lấy đồng hồ DB là cái giá quá đắt so
 * với lợi ích: host Render và Postgres Render nằm cùng region, lệch dưới một
 * giây, trong khi độ chính xác đăng bài tính bằng phút. Bốn reconciler
 * (`*SchedulerService`) thì dùng đồng hồ DB vì chúng vốn đã là SQL thô — và
 * luôn ở dạng `(NOW() AT TIME ZONE 'utc')`, không bao giờ `NOW()` trần: cột là
 * `timestamp WITHOUT time zone` chứa giờ UTC, nên `NOW()` trần sẽ lệch đúng
 * bằng offset múi giờ của phiên DB.
 *
 * **Mỗi thao tác chỉ tạo `now` một lần** rồi truyền xuống mọi truy vấn con —
 * đặc biệt là cặp `count` + `findMany` của phân trang. Gọi `new Date()` hai lần
 * có thể làm tổng số bài và nội dung trang bất đồng đúng tại giây đáo hạn.
 */

/** Hình dạng tối thiểu để xét hiển thị — khớp mọi model có lịch đăng. */
export interface PublishableRecord {
  status: ContentStatus;
  scheduledAt: Date | null;
}

/**
 * Mảnh `where` cho Prisma: `findMany`, `count`, `groupBy`.
 *
 * Kiểu trả về gắn với `NewsPost`. Cả bốn module có lịch đăng — Bài viết, Dự án,
 * Trang, Dự án hợp tác — nay đều dùng luật hiển thị này, nhưng mỗi model gọi tên
 * cột bậc thang duyệt một kiểu (`status` ở News/Pages, `contentStatus` ở
 * Projects/Cooperation). Vì vậy file giữ các hàm chị em riêng cho từng bảng
 * (`projectPubliclyVisibleWhere`, `pagePubliclyVisibleWhere`,
 * `cooperationPubliclyVisibleWhere`) thay vì một lớp generic làm kiểu yếu đi —
 * luật thì một, chữ ký thì theo từng model.
 */
export function publiclyVisibleWhere(now: Date): Prisma.NewsPostWhereInput {
  return {
    OR: [
      { status: ContentStatus.PUBLISHED },
      {
        status: ContentStatus.PENDING,
        // `lte` một mình đã loại NULL ở tầng SQL; `not: null` viết ra để luật
        // đọc lên đúng như phát biểu và không phụ thuộc hành vi ngầm.
        scheduledAt: { not: null, lte: now },
      },
    ],
  };
}

/**
 * Vị từ trên bản ghi đã nạp — dùng cho `findUnique` rồi mới quyết định 404.
 *
 * Nhận structural type nên dùng lại được cho bất kỳ model nào có đủ hai field,
 * mà không cần generic.
 */
export function isPubliclyVisible(
  record: PublishableRecord,
  now: Date,
): boolean {
  if (record.status === ContentStatus.PUBLISHED) return true;

  return (
    record.status === ContentStatus.PENDING &&
    record.scheduledAt !== null &&
    record.scheduledAt.getTime() <= now.getTime()
  );
}

/**
 * Mảnh SQL cho `search.service.ts` — nơi duy nhất truy vấn tin bằng SQL thô,
 * nên `where` của Prisma không với tới được.
 *
 * Cố định alias `n` cho khớp `FROM "news_posts" n` trong SearchService: tên cột
 * và alias là **định danh**, không tham số hoá được, nên hardcode ở đây an toàn
 * hơn là nhận chuỗi từ bên ngoài. `${now}` đi qua bind parameter của
 * `Prisma.sql` — không nối chuỗi, không SQL injection.
 */
export function newsPubliclyVisibleSql(now: Date): Prisma.Sql {
  return Prisma.sql`(
    n."status" = 'PUBLISHED'::"ContentStatus"
    OR (
      n."status" = 'PENDING'::"ContentStatus"
      AND n."scheduled_at" IS NOT NULL
      AND n."scheduled_at" <= ${now}
    )
  )`;
}

/* -------------------------------------------------------------------------
   DỰ ÁN — hàm chị em của ba hàm trên.

   Cố ý KHÔNG gộp thành một hàm generic nhận tên cột: `NewsPost` gọi cột trạng
   thái là `status`, `Project` gọi là `contentStatus` (và `Project.status` lại
   là TÌNH TRẠNG THI CÔNG — một khái niệm hoàn toàn khác). Một hàm nhận tên cột
   dạng chuỗi sẽ vứt bỏ đúng thứ đang bảo vệ ta ở đây: kiểu `Prisma.*WhereInput`
   bắt lỗi ngay lúc biên dịch nếu ai đó nhắm nhầm cột. Ba hàm ngắn, đọc thẳng
   ra luật, hơn một lớp trừu tượng khiến `Project.status` có cơ hội lọt vào một
   vị từ xuất bản.
   ------------------------------------------------------------------------- */

/** Hình dạng tối thiểu để xét hiển thị của một dự án. */
export interface PublishableProject {
  contentStatus: ContentStatus;
  scheduledAt: Date | null;
}

/**
 * Mảnh `where` cho Prisma trên bảng `projects` — dùng cho MỌI truy vấn công
 * khai (danh sách, chi tiết, section trang chủ).
 *
 * Luật giống hệt tin tức, chỉ khác tên cột:
 *
 * ```
 * contentStatus = PUBLISHED
 * HOẶC (contentStatus = PENDING AND scheduled_at IS NOT NULL AND scheduled_at <= now)
 * ```
 *
 * Ràng buộc `PENDING` ở nhánh hai là chốt bảo mật, không phải chi tiết thừa:
 * bỏ nó đi thì một hàng dị dạng `DRAFT` + `scheduled_at` quá khứ sẽ lọt ra
 * công khai. Rủi ro của việc bỏ sót phải là "hiện muộn", không phải "rò rỉ sớm".
 */
export function projectPubliclyVisibleWhere(
  now: Date,
): Prisma.ProjectWhereInput {
  return {
    OR: [
      { contentStatus: ContentStatus.PUBLISHED },
      {
        contentStatus: ContentStatus.PENDING,
        scheduledAt: { not: null, lte: now },
      },
    ],
  };
}

/** Vị từ trên bản ghi dự án đã nạp — dùng cho `findUnique` rồi mới quyết định 404. */
export function isProjectPubliclyVisible(
  project: PublishableProject,
  now: Date,
): boolean {
  if (project.contentStatus === ContentStatus.PUBLISHED) return true;

  return (
    project.contentStatus === ContentStatus.PENDING &&
    project.scheduledAt !== null &&
    project.scheduledAt.getTime() <= now.getTime()
  );
}

/**
 * Mảnh SQL cho `search.service.ts` — nơi duy nhất truy vấn dự án bằng SQL thô.
 *
 * Cố định alias `p` cho khớp `FROM "projects" p` trong SearchService. `${now}`
 * đi qua bind parameter của `Prisma.sql` — không nối chuỗi, không SQL injection.
 */
export function projectPubliclyVisibleSql(now: Date): Prisma.Sql {
  return Prisma.sql`(
    p."content_status" = 'PUBLISHED'::"ContentStatus"
    OR (
      p."content_status" = 'PENDING'::"ContentStatus"
      AND p."scheduled_at" IS NOT NULL
      AND p."scheduled_at" <= ${now}
    )
  )`;
}

/* -------------------------------------------------------------------------
   DỰ ÁN HỢP TÁC — hàm chị em, cùng luật, khác kiểu `where` của Prisma.

   Vì sao lại thêm một cặp hàm nữa thay vì dùng lại của Dự án: `where` phải mang
   đúng kiểu `Prisma.CooperationProjectWhereInput` thì TypeScript mới bắt được
   lỗi nhắm nhầm cột. Và ở model này việc nhắm nhầm cột là rủi ro THẬT, không
   phải giả định: `CooperationProject.status` là JSONB mô tả bằng chữ (song ngữ,
   vd. {"vi":"Đã bàn giao"}), trong khi bậc thang duyệt là `contentStatus`. Một
   hàm generic nhận tên cột dạng chuỗi sẽ vứt bỏ đúng lớp bảo vệ đó.

   KHÔNG có bản `...Sql`: dự án hợp tác không nằm trong tìm kiếm (SearchService
   chỉ truy vấn `projects` và `news_posts` bằng SQL thô), nên không có chỗ nào
   cần mảnh SQL. Thêm một hàm không ai gọi chỉ tạo thêm thứ để lệch nhau.
   ------------------------------------------------------------------------- */

/** Hình dạng tối thiểu để xét hiển thị của một dự án hợp tác. */
export interface PublishableCooperationProject {
  contentStatus: ContentStatus;
  scheduledAt: Date | null;
}

/**
 * Mảnh `where` cho Prisma trên bảng `cooperation_projects` — dùng cho MỌI truy
 * vấn công khai. Hiện chỉ có một: `GET /cooperation` (section "Dự án hợp tác"
 * ở trang chủ).
 *
 * ```
 * contentStatus = PUBLISHED
 * HOẶC (contentStatus = PENDING AND scheduled_at IS NOT NULL AND scheduled_at <= now)
 * ```
 *
 * Ràng buộc `PENDING` ở nhánh hai là chốt bảo mật: bỏ nó đi thì một hàng dị
 * dạng `DRAFT` + `scheduled_at` quá khứ sẽ lọt ra công khai.
 */
export function cooperationPubliclyVisibleWhere(
  now: Date,
): Prisma.CooperationProjectWhereInput {
  return {
    OR: [
      { contentStatus: ContentStatus.PUBLISHED },
      {
        contentStatus: ContentStatus.PENDING,
        scheduledAt: { not: null, lte: now },
      },
    ],
  };
}

/** Vị từ trên bản ghi đã nạp — dùng khi đã `findUnique` rồi mới quyết định. */
export function isCooperationPubliclyVisible(
  project: PublishableCooperationProject,
  now: Date,
): boolean {
  if (project.contentStatus === ContentStatus.PUBLISHED) return true;

  return (
    project.contentStatus === ContentStatus.PENDING &&
    project.scheduledAt !== null &&
    project.scheduledAt.getTime() <= now.getTime()
  );
}

/* -------------------------------------------------------------------------
   TRANG NỘI DUNG — hàm chị em, cùng luật.

   `Page` gọi cột trạng thái là `status` (giống `NewsPost`), nên vị từ trên bản
   ghi đã nạp dùng lại được `isPubliclyVisible` ở trên mà không cần hàm mới —
   `PublishableRecord` là structural type khớp sẵn. Chỉ `where` là phải có bản
   riêng, vì nó gắn kiểu với đúng một model để TypeScript bắt được lỗi nhắm
   nhầm cột.
   ------------------------------------------------------------------------- */

/**
 * Mảnh `where` cho Prisma trên bảng `pages` — dùng cho CẢ HAI truy vấn công
 * khai (`GET /pages` và `GET /pages/:slug`).
 *
 * ```
 * status = PUBLISHED
 * HOẶC (status = PENDING AND scheduled_at IS NOT NULL AND scheduled_at <= now)
 * ```
 *
 * Ràng buộc `PENDING` ở nhánh hai là chốt bảo mật: bỏ nó đi thì một hàng dị
 * dạng `DRAFT` + `scheduled_at` quá khứ sẽ lọt ra công khai.
 */
export function pagePubliclyVisibleWhere(now: Date): Prisma.PageWhereInput {
  return {
    OR: [
      { status: ContentStatus.PUBLISHED },
      {
        status: ContentStatus.PENDING,
        scheduledAt: { not: null, lte: now },
      },
    ],
  };
}
