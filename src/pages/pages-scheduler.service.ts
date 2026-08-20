import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

type PublishedRow = { id: string; slug: string };

/**
 * Đăng trang nội dung tự động theo `scheduled_at` (Batch 11) — bản sao có chủ
 * đích của `NewsSchedulerService`, chạy trên bảng `pages`.
 *
 * Cố ý KHÔNG viết một reconciler generic nhận tên bảng: tên bảng và tên cột là
 * **định danh**, không tham số hoá được qua bind parameter, nên một reconciler
 * "dùng chung" sẽ phải nối chuỗi SQL — đúng thứ ta không muốn ở một job chạy
 * nền có quyền đổi trạng thái công khai. Mỗi lớp một câu SQL đọc thẳng ra luật.
 *
 * Toàn bộ việc đăng nằm trong **một câu UPDATE có điều kiện** thay vì đọc rồi
 * ghi: Postgres khoá hàng khi UPDATE, nên hai instance backend không đăng trùng.
 *
 * Cột trạng thái của bảng này là `status` (giống `news_posts`), KHÔNG phải
 * `content_status` như `projects`/`cooperation_projects`.
 */
@Injectable()
export class PagesSchedulerService {
  private readonly logger = new Logger(PagesSchedulerService.name);

  /** Chặn hai lượt cron chồng nhau trong cùng tiến trình khi DB phản hồi chậm. */
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'publish-scheduled-pages' })
  async handleCron(): Promise<void> {
    if (this.running) {
      this.logger.warn('Lượt đăng trang theo lịch trước chưa xong — bỏ qua');
      return;
    }
    this.running = true;
    try {
      const published = await this.publishDuePages();
      if (published.length > 0) {
        this.logger.log(
          `Đã đăng ${published.length} trang theo lịch: ${published
            .map((page) => page.slug)
            .join(', ')}`,
        );
      }
    } catch (error) {
      // Cron không được ném lỗi ra ngoài, nếu không tiến trình Nest sẽ nhận
      // unhandled rejection. Lượt sau vẫn quét lại đúng các trang chưa đăng.
      this.logger.error(
        'Đăng trang theo lịch thất bại, sẽ thử lại ở lượt kế tiếp',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Trả về các trang vừa chuyển sang PUBLISHED. Gọi lại ngay sau đó trả mảng rỗng.
   *
   * `published_at` giữ nguyên nếu trang đã có mốc — lệnh đặt lịch ghi sẵn
   * `published_at = scheduled_at`, nên `COALESCE` ở đây giữ đúng **giờ đã hẹn**,
   * không phải giờ cron tình cờ chạy. Đây là điều kiện để `published_at` mãi mãi
   * mang nghĩa "lần công khai đầu tiên".
   *
   * `scheduled_at = NULL` sau khi đăng: trạng thái chuẩn tắc của trang đã đăng
   * là **không còn lịch treo**. Các lệnh đổi trạng thái thủ công cũng áp đúng
   * luật đó (`clearedSchedule`); nếu reconciler để lại `scheduled_at`, hai đường
   * dẫn tới cùng một trạng thái sẽ cho ra hai hình dạng dữ liệu khác nhau.
   *
   * Chạy lại bao nhiêu lần cũng chỉ đăng một lần: sau lượt đầu bản ghi đã là
   * PUBLISHED nên không còn khớp `status = 'PENDING'`, và `scheduled_at` cũng đã
   * NULL nên không khớp `scheduled_at IS NOT NULL` — hai lớp chặn độc lập.
   *
   * ## Vì sao điều kiện là `status = 'PENDING'`, không phải `<> 'PUBLISHED'`
   *
   * Đây là chốt bảo mật, không phải chuyện gọn câu SQL. Vị từ hiển thị công khai
   * (`pagePubliclyVisibleWhere`) cố ý bắt nhánh lịch phải kèm `PENDING`, để một
   * hàng dị dạng `DRAFT` + `scheduled_at` quá khứ **không** lọt ra ngoài. Nếu
   * reconciler quét theo `<> 'PUBLISHED'` thì nó khớp luôn hàng DRAFT đó và **tự
   * tay đổi nó thành PUBLISHED** — lớp phòng thủ bị vô hiệu hoá từ phía sau, bởi
   * một job chạy nền không ai nhìn.
   *
   * Nguyên tắc: **tập bản ghi reconciler được phép đăng phải là tập con của tập
   * bản ghi vị từ hiển thị coi là công khai.**
   *
   * ## Mốc thời gian phải ở hệ quy chiếu UTC
   *
   * `scheduled_at`/`published_at`/`updated_at` là `timestamp WITHOUT time zone`
   * và Prisma ghi **giờ UTC** vào đó. `NOW()` trả `timestamptz`, nên khi so hoặc
   * gán, Postgres quy đổi theo `TimeZone` của phiên — trên DB không phải UTC,
   * `NOW()` trần làm trang đăng SỚM đúng bằng offset múi giờ (đo được: +7 giờ
   * trên phiên `Asia/Bangkok`). `NOW() AT TIME ZONE 'utc'` đưa "bây giờ" về đúng
   * hệ quy chiếu của cột.
   */
  async publishDuePages(): Promise<PublishedRow[]> {
    return this.prisma.$queryRaw<PublishedRow[]>`
      UPDATE "pages"
      SET "status" = 'PUBLISHED'::"ContentStatus",
          "published_at" = COALESCE("published_at", "scheduled_at"),
          "scheduled_at" = NULL,
          "updated_at" = (NOW() AT TIME ZONE 'utc')
      WHERE "status" = 'PENDING'::"ContentStatus"
        AND "scheduled_at" IS NOT NULL
        AND "scheduled_at" <= (NOW() AT TIME ZONE 'utc')
      RETURNING "id", "slug"
    `;
  }
}
