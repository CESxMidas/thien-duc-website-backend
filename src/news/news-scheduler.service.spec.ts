import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { NewsSchedulerService } from './news-scheduler.service';

/**
 * `NewsSchedulerService` chạy nền và tự đăng bài — nó là đường duy nhất trong
 * hệ thống có thể đưa nội dung ra công khai mà **không có ai bấm nút**. Trước
 * batch này nó hoàn toàn không có test.
 *
 * Cách test: toàn bộ nghiệp vụ nằm trong MỘT câu `$queryRaw`, nên bài test
 * không so sánh kết quả SQL (việc đó thuộc e2e với DB thật) mà khoá **hợp đồng
 * của câu SQL**: nó phải giữ đủ các mệnh đề khiến việc đăng theo lịch trở nên
 * idempotent và không ghi đè `published_at`. Câu SQL này chính là nơi bốn tính
 * chất đó được bảo đảm, nên đọc nó là cách kiểm chứng trung thực nhất mà không
 * cần Postgres.
 *
 * Không dùng đồng hồ thật ở bất kỳ đâu: thời điểm so sánh là `NOW()` của
 * Postgres, nằm trong chuỗi SQL — nên test không bao giờ flaky lúc nửa đêm.
 */

/**
 * Nối template literal của `$queryRaw` ở lượt gọi thứ `index` lại thành SQL
 * phẳng để soi mệnh đề. Nhận thẳng mock (đã có kiểu) thay vì nhận `calls[i]`
 * (kiểu `any`) để không phải nới lỏng kiểu ở từng chỗ gọi.
 */
function sqlAt(queryRaw: jest.Mock, index: number): string {
  const [strings] = queryRaw.mock.calls[index] as [TemplateStringsArray];
  return strings.join('?').replace(/\s+/g, ' ').trim();
}

describe('NewsSchedulerService', () => {
  let service: NewsSchedulerService;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NewsSchedulerService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(NewsSchedulerService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('publishDuePosts — hợp đồng của câu UPDATE', () => {
    it('trả về đúng danh sách bài vừa đăng', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 'n1', slug: 'bai-den-han' },
        { id: 'n2', slug: 'bai-den-han-2' },
      ]);

      await expect(service.publishDuePosts()).resolves.toEqual([
        { id: 'n1', slug: 'bai-den-han' },
        { id: 'n2', slug: 'bai-den-han-2' },
      ]);
    });

    it('không có bài nào tới hạn → mảng rỗng, không lỗi', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(service.publishDuePosts()).resolves.toEqual([]);
    });

    it('chỉ đăng bài đã TỚI HẠN (`scheduled_at <= NOW()`), không đăng bài hẹn tương lai', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await service.publishDuePosts();

      const sql = sqlAt(prisma.$queryRaw, 0);
      expect(sql).toContain('"scheduled_at" <= NOW()');
      // Mốc so sánh phải là đồng hồ của Postgres, không phải của tiến trình
      // Node — hai instance backend trên Render mới không bất đồng vài giây.
      expect(sql).not.toContain('$1');
    });

    it('bỏ qua bài chưa từng đặt lịch (`scheduled_at IS NOT NULL`)', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await service.publishDuePosts();

      expect(sqlAt(prisma.$queryRaw, 0)).toContain(
        '"scheduled_at" IS NOT NULL',
      );
    });

    it('bỏ qua bài đã PUBLISHED — đây là mệnh đề làm cho việc chạy lại là idempotent', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await service.publishDuePosts();

      expect(sqlAt(prisma.$queryRaw, 0)).toContain(`"status" <> 'PUBLISHED'`);
    });

    it('không ghi đè `published_at` đã có — giữ mốc đăng lần đầu', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await service.publishDuePosts();

      // COALESCE: lệnh đặt lịch (Batch 3) đã ghi sẵn `published_at =
      // scheduled_at`, nên nhánh này giữ đúng GIỜ ĐÃ HẸN chứ không phải giờ cron
      // tình cờ chạy — nếu không, thứ tự trang tin (sắp theo published_at) sẽ
      // phụ thuộc vào lúc cron thức dậy. Nhánh `scheduled_at` còn lại đỡ cho dữ
      // liệu cũ tạo trước Batch 3.
      expect(sqlAt(prisma.$queryRaw, 0)).toContain(
        'COALESCE("published_at", "scheduled_at")',
      );
    });

    it('XOÁ `scheduled_at` sau khi đăng — trạng thái chuẩn tắc khớp Batch 1', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await service.publishDuePosts();

      // Batch 1 quy định PUBLISHED ⇒ scheduledAt = NULL cho mọi lần đổi trạng
      // thái thủ công. Reconciler để lại `scheduled_at` sẽ tạo ra hình dạng dữ
      // liệu thứ hai cho cùng một trạng thái, và Admin (Batch 4) không phân biệt
      // được "đã đăng" với "đã đăng nhưng còn lịch treo".
      expect(sqlAt(prisma.$queryRaw, 0)).toContain('"scheduled_at" = NULL');
    });

    it('chạy hai lần liên tiếp là an toàn: lượt sau không khớp bài nào', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: 'n1', slug: 'bai-den-han' }])
        .mockResolvedValueOnce([]);

      const first = await service.publishDuePosts();
      const second = await service.publishDuePosts();

      expect(first).toHaveLength(1);
      expect(second).toEqual([]);
      // Cùng một câu SQL cho cả hai lượt — tính idempotent đến từ mệnh đề
      // WHERE, không đến từ việc service nhớ đã chạy gì.
      expect(sqlAt(prisma.$queryRaw, 0)).toBe(sqlAt(prisma.$queryRaw, 1));
    });
  });

  describe('handleCron — vỏ bọc chịu lỗi', () => {
    it('lỗi DB được nuốt và ghi log, KHÔNG ném ra ngoài', async () => {
      // Cron ném lỗi ra ngoài sẽ thành unhandled rejection và có thể hạ cả
      // tiến trình Nest. Lượt sau vẫn quét lại đúng tập bài chưa đăng.
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      prisma.$queryRaw.mockRejectedValue(new Error('connection terminated'));

      await expect(service.handleCron()).resolves.toBeUndefined();
      expect(logError).toHaveBeenCalled();
    });

    it('sau khi lỗi, lượt cron kế tiếp vẫn chạy (cờ chống chồng lượt được nhả)', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      prisma.$queryRaw
        .mockRejectedValueOnce(new Error('connection terminated'))
        .mockResolvedValueOnce([{ id: 'n1', slug: 'bai-den-han' }]);

      await service.handleCron();
      await service.handleCron();

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('lượt cron mới bị bỏ qua khi lượt trước chưa xong', async () => {
      const logWarn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      let releaseFirstRun!: (rows: unknown[]) => void;
      prisma.$queryRaw.mockReturnValueOnce(
        new Promise((resolve) => {
          releaseFirstRun = resolve;
        }),
      );

      const firstRun = service.handleCron();
      await service.handleCron(); // chồng lên lượt đang chạy

      expect(logWarn).toHaveBeenCalled();
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);

      releaseFirstRun([]);
      await firstRun;
    });

    it('ghi log slug các bài vừa đăng — dấu vết vận hành duy nhất hiện có', async () => {
      const logInfo = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      prisma.$queryRaw.mockResolvedValue([{ id: 'n1', slug: 'bai-den-han' }]);

      await service.handleCron();

      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('bai-den-han'),
      );
    });

    it('không có bài nào tới hạn → không ghi log nhiễu', async () => {
      const logInfo = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      prisma.$queryRaw.mockResolvedValue([]);

      await service.handleCron();

      expect(logInfo).not.toHaveBeenCalled();
    });
  });
});
