import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

type PublishedRow = { id: string };

/**
 * Đăng dự án hợp tác tự động theo `scheduled_at` (Batch 10) — bản sao có chủ
 * đích của `ProjectsSchedulerService`, chạy trên bảng `cooperation_projects`.
 *
 * Cố ý KHÔNG viết một reconciler generic nhận tên bảng: tên bảng và tên cột là
 * **định danh**, không tham số hoá được qua bind parameter, nên một reconciler
 * "dùng chung" sẽ phải nối chuỗi SQL — đúng thứ ta không muốn ở một job chạy
 * nền có quyền đổi trạng thái công khai. Mỗi lớp một câu SQL đọc thẳng ra luật,
 * an toàn hơn một lớp trừu tượng.
 *
 * Toàn bộ việc đăng nằm trong **một câu UPDATE có điều kiện** thay vì đọc rồi
 * ghi: Postgres khoá hàng khi UPDATE, nên hai instance backend không đăng trùng.
 *
 * Trả về `id` chứ không phải `slug`: `cooperation_projects` không có cột slug —
 * định danh chuẩn của model này là `id` (uuid).
 */
@Injectable()
export class CooperationSchedulerService {
  private readonly logger = new Logger(CooperationSchedulerService.name);

  /** Chặn hai lượt cron chồng nhau trong cùng tiến trình khi DB phản hồi chậm. */
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'publish-scheduled-cooperation',
  })
  async handleCron(): Promise<void> {
    if (this.running) {
      this.logger.warn(
        'Lượt đăng dự án hợp tác theo lịch trước chưa xong — bỏ qua',
      );
      return;
    }
    this.running = true;
    try {
      const published = await this.publishDueProjects();
      if (published.length > 0) {
        this.logger.log(
          `Đã đăng ${published.length} dự án hợp tác theo lịch: ${published
            .map((project) => project.id)
            .join(', ')}`,
        );
      }
    } catch (error) {
      // Cron không được ném lỗi ra ngoài, nếu không tiến trình Nest sẽ nhận
      // unhandled rejection. Lượt sau vẫn quét lại đúng các bản ghi chưa đăng.
      this.logger.error(
        'Đăng dự án hợp tác theo lịch thất bại, sẽ thử lại ở lượt kế tiếp',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Trả về các dự án hợp tác vừa chuyển sang PUBLISHED. Gọi lại ngay sau đó trả
   * mảng rỗng.
   *
   * `published_at` giữ nguyên nếu bản ghi đã có mốc — lệnh đặt lịch ghi sẵn
   * `published_at = scheduled_at`, nên `COALESCE` ở đây giữ đúng **giờ đã hẹn**,
   * không phải giờ cron tình cờ chạy. Đây là điều kiện để `published_at` mãi mãi
   * mang nghĩa "lần công khai đầu tiên".
   *
   * `scheduled_at = NULL` sau khi đăng: trạng thái chuẩn tắc của bản đã đăng là
   * **không còn lịch treo**. Các lệnh đổi trạng thái thủ công cũng áp đúng luật
   * đó (`clearedSchedule`); nếu reconciler để lại `scheduled_at`, hai đường dẫn
   * tới cùng một trạng thái sẽ cho ra hai hình dạng dữ liệu khác nhau.
   *
   * Chạy lại bao nhiêu lần cũng chỉ đăng một lần: sau lượt đầu bản ghi đã là
   * PUBLISHED nên không còn khớp `content_status = 'PENDING'`, và `scheduled_at`
   * cũng đã NULL nên không khớp `scheduled_at IS NOT NULL` — hai lớp chặn độc lập.
   *
   * ## Vì sao điều kiện là `content_status = 'PENDING'`, không phải `<> 'PUBLISHED'`
   *
   * Đây là chốt bảo mật, không phải chuyện gọn câu SQL.
   *
   * Vị từ hiển thị công khai (`cooperationPubliclyVisibleWhere`) cố ý bắt nhánh
   * lịch phải kèm `PENDING`, để một hàng dị dạng `DRAFT` + `scheduled_at` quá
   * khứ **không** lọt ra ngoài. Nhưng nếu reconciler quét theo `<> 'PUBLISHED'`
   * thì nó khớp luôn hàng DRAFT đó và **tự tay đổi nó thành PUBLISHED** — sau đó
   * hàng này công khai qua nhánh thứ nhất của chính vị từ kia. Lớp phòng thủ bị
   * vô hiệu hoá từ phía sau, bởi một job chạy nền không ai nhìn.
   *
   * Nguyên tắc: **tập bản ghi reconciler được phép đăng phải là tập con của tập
   * bản ghi vị từ hiển thị coi là công khai.**
   *
   * Và KHÔNG bao giờ dùng cột `status` của bảng này: đó là JSONB mô tả bằng chữ
   * ("Đã bàn giao"), không phải trạng thái xuất bản.
   *
   * ## Vì sao là `NOW() AT TIME ZONE 'utc'` chứ không phải `NOW()`
   *
   * `scheduled_at` là `timestamp WITHOUT time zone`, và Prisma ghi xuống đó
   * **giờ UTC**. `NOW()` thì trả `timestamptz`. Khi Postgres so `timestamp` với
   * `timestamptz`, nó quy đổi vế `timestamp` sang `timestamptz` **theo TimeZone
   * của phiên** — nên trên một DB có `TimeZone` khác UTC, con số UTC trong cột
   * bị diễn giải như giờ địa phương.
   *
   * Đo được trên PostgreSQL thật (phiên `Asia/Bangkok`):
   *
   * ```
   * scheduled_at (Prisma ghi) : 2026-08-19 15:29:53   ← UTC
   * NOW()                     : 2026-08-19 21:29:54 +07
   * scheduled_at <= NOW()                  →  true    ← SAI: lịch còn 1 giờ nữa
   * scheduled_at <= NOW() AT TIME ZONE 'utc' → false  ← đúng
   * ```
   *
   * Sai lệch bằng đúng offset múi giờ, và sai theo hướng **tệ nhất**: nội dung
   * ra công khai SỚM tới 7 giờ so với giờ đã hẹn. `AT TIME ZONE 'utc'` đưa "bây
   * giờ" về đúng hệ quy chiếu mà cột đang lưu, nên phép so không còn phụ thuộc
   * cấu hình của máy chủ DB.
   *
   * Vị từ hiển thị (`cooperationPubliclyVisibleWhere`) KHÔNG dính lỗi này: nó đi
   * qua `where` của Prisma với một `Date` của JS, và Prisma bind cả hai vế ở
   * cùng hệ quy chiếu UTC.
   *
   * Phép GÁN cũng vậy: `"updated_at" = NOW()` ghi giờ ĐỊA PHƯƠNG vào cột UTC
   * (đo được: lệch đúng 7 giờ trên phiên `Asia/Bangkok`), nên nó cũng phải đi
   * qua `AT TIME ZONE 'utc'`.
   */
  async publishDueProjects(): Promise<PublishedRow[]> {
    return this.prisma.$queryRaw<PublishedRow[]>`
      UPDATE "cooperation_projects"
      SET "content_status" = 'PUBLISHED'::"ContentStatus",
          "published_at" = COALESCE("published_at", "scheduled_at"),
          "scheduled_at" = NULL,
          "updated_at" = (NOW() AT TIME ZONE 'utc')
      WHERE "content_status" = 'PENDING'::"ContentStatus"
        AND "scheduled_at" IS NOT NULL
        AND "scheduled_at" <= (NOW() AT TIME ZONE 'utc')
      RETURNING "id"
    `;
  }
}
