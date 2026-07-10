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
   * `published_at` giữ nguyên nếu bài từng đăng rồi (đăng lại sau khi hạ nháp),
   * đồng bộ với `NewsService.updateStatus`.
   */
  async publishDuePosts(): Promise<PublishedRow[]> {
    return this.prisma.$queryRaw<PublishedRow[]>`
      UPDATE "news_posts"
      SET "status" = 'PUBLISHED'::"ContentStatus",
          "published_at" = COALESCE("published_at", "scheduled_at"),
          "updated_at" = NOW()
      WHERE "status" <> 'PUBLISHED'::"ContentStatus"
        AND "scheduled_at" IS NOT NULL
        AND "scheduled_at" <= NOW()
      RETURNING "id", "slug"
    `;
  }
}
