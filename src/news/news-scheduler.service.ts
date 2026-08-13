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
   * Chạy lại bao nhiêu lần cũng chỉ đăng một lần: `status <> 'PUBLISHED'` khiến
   * lượt sau không khớp hàng nào — và sau lượt đầu, `scheduled_at IS NOT NULL`
   * cũng không còn khớp nữa, nên có tới hai lớp chặn.
   */
  async publishDuePosts(): Promise<PublishedRow[]> {
    return this.prisma.$queryRaw<PublishedRow[]>`
      UPDATE "news_posts"
      SET "status" = 'PUBLISHED'::"ContentStatus",
          "published_at" = COALESCE("published_at", "scheduled_at"),
          "scheduled_at" = NULL,
          "updated_at" = NOW()
      WHERE "status" <> 'PUBLISHED'::"ContentStatus"
        AND "scheduled_at" IS NOT NULL
        AND "scheduled_at" <= NOW()
      RETURNING "id", "slug"
    `;
  }
}
