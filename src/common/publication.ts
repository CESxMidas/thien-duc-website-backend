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
 * giây, trong khi độ chính xác đăng bài tính bằng phút. `NewsSchedulerService`
 * vẫn dùng `NOW()` của DB vì nó đã là SQL thô sẵn.
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
 * Kiểu trả về gắn với `NewsPost` vì đây là model duy nhất có `scheduledAt` ở
 * thời điểm này. Projects/Pages/Cooperation dùng tên cột khác (`contentStatus`)
 * và chưa có cột lịch — khi tới lượt chúng, thêm hàm chị em bên cạnh hàm này
 * thay vì dựng một lớp generic làm kiểu yếu đi.
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
