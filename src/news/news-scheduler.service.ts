import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

type PublishedRow = { id: string; slug: string };

/**
 * Đăng bài tự động theo `scheduled_at` (ED-08).
 *
 * Toàn bộ việc đăng nằm trong **một câu UPDATE có điều kiện** thay vì đọc rồi
 * ghi: `status <> 'PUBLISHED'` khiến lượt chạy thứ hai không khớp bản ghi nào,
 * nên chạy lại bao nhiêu lần cũng chỉ đăng đúng một lần. Postgres khóa hàng khi
 * UPDATE, nên hai instance backend (Render có thể chạy nhiều) không đăng trùng.
 */
@Injectable()
export class NewsSchedulerService {
  private readonly logger = new Logger(NewsSchedulerService.name);

  /** Chặn hai lượt cron chồng nhau trong cùng tiến trình khi DB phản hồi chậm. */
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'publish-scheduled-news' })
  async handleCron(): Promise<void> {
    if (this.running) {
      this.logger.warn('Lượt đăng theo lịch trước chưa xong — bỏ qua lượt này');
      return;
    }
    this.running = true;
    try {
      const published = await this.publishDuePosts();
      if (published.length > 0) {
        this.logger.log(
          `Đã đăng ${published.length} bài theo lịch: ${published
            .map((post) => post.slug)
            .join(', ')}`,
        );
      }
    } catch (error) {
      // Cron không được ném lỗi ra ngoài, nếu không tiến trình Nest sẽ nhận
      // unhandled rejection. Lượt sau vẫn quét lại đúng các bài chưa đăng.
      this.logger.error(
        'Đăng bài theo lịch thất bại, sẽ thử lại ở lượt kế tiếp',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Trả về các bài vừa chuyển sang PUBLISHED. Gọi lại ngay sau đó trả mảng rỗng.
   *
   * `published_at` giữ nguyên nếu bài đã có mốc — lệnh đặt lịch
   * (`NewsService.schedulePublication`) ghi sẵn `published_at = scheduled_at`,
   * nên `COALESCE` ở đây giữ đúng **giờ đã hẹn**, không phải giờ cron tình cờ
   * chạy. Nhánh `scheduled_at` chỉ còn đỡ cho dữ liệu cũ tạo trước Batch 3.
   *
   * `scheduled_at = NULL` sau khi đăng: trạng thái chuẩn tắc của bài đã đăng là
   * **không còn lịch treo**. Batch 1 đã áp đúng luật đó cho mọi lần đổi trạng
   * thái thủ công (`clearedSchedule`); nếu reconciler để lại `scheduled_at`, hai
   * đường dẫn tới cùng một trạng thái sẽ cho ra hai hình dạng dữ liệu khác nhau,
   * và Admin không thể phân biệt "đã đăng" với "đã đăng nhưng còn lịch" khi dựng
   * nhãn ở Batch 4.
   *
   * Chạy lại bao nhiêu lần cũng chỉ đăng một lần: sau lượt đầu bản ghi đã là
   * PUBLISHED nên không còn khớp `status = 'PENDING'`, và `scheduled_at` cũng đã
   * NULL nên không khớp `scheduled_at IS NOT NULL` — hai lớp chặn độc lập.
   *
   * ## Vì sao điều kiện là `status = 'PENDING'` chứ không phải `<> 'PUBLISHED'`
   *
   * Đây là chốt bảo mật, không phải chuyện gọn câu SQL.
   *
   * Vị từ hiển thị công khai (`common/publication.ts`) cố ý bắt nhánh lịch phải
   * kèm `PENDING`, để một hàng dị dạng `DRAFT` + `scheduled_at` quá khứ **không**
   * lọt ra ngoài. Nhưng nếu reconciler quét theo `status <> 'PUBLISHED'` thì nó
   * khớp luôn cả hàng DRAFT đó và **tự tay đổi nó thành PUBLISHED** — sau đó
   * hàng này công khai qua nhánh thứ nhất của chính vị từ kia. Lớp phòng thủ bị
   * vô hiệu hoá từ phía sau, bởi một job chạy nền không ai nhìn.
   *
   * Nguyên tắc: **tập bài reconciler được phép đăng phải là tập con của tập bài
   * vị từ hiển thị coi là công khai.** `status = 'PENDING'` làm hai bên khớp
   * nhau đúng từng điều kiện một.
   *
   * ## Mốc thời gian phải ở hệ quy chiếu UTC
   *
   * `scheduled_at`/`published_at`/`updated_at` là `timestamp WITHOUT time zone`
   * và Prisma ghi **giờ UTC** vào đó. `NOW()` trả `timestamptz`, nên khi so hoặc
   * gán, Postgres quy đổi theo `TimeZone` của phiên — trên DB không phải UTC,
   * `NOW()` trần làm bài đăng SỚM đúng bằng offset múi giờ (đo được: +7 giờ trên
   * phiên `Asia/Bangkok`). `NOW() AT TIME ZONE 'utc'` đưa "bây giờ" về đúng hệ
   * quy chiếu của cột.
   */
  async publishDuePosts(): Promise<PublishedRow[]> {
    return this.prisma.$queryRaw<PublishedRow[]>`
      UPDATE "news_posts"
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
