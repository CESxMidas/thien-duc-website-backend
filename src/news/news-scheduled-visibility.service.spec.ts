import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NewsService } from './news.service';

/**
 * **Chứng minh kiến trúc Hybrid ở tầng service.**
 *
 * Trước batch này, bài đã lên lịch chỉ ra công khai sau khi
 * `NewsSchedulerService` kịp đổi `status` thành PUBLISHED. Render Free ngủ sau
 * 15 phút không traffic, nên lượt cron lúc 08:00 hoàn toàn có thể không chạy —
 * và bài không bao giờ lên. Nay điều kiện được đánh giá **lúc truy vấn**: bài
 * đã tới hạn là công khai ngay ở request đầu tiên, kể cả khi trạng thái lưu trữ
 * còn là PENDING.
 *
 * Các test ở đây cố ý **không** cho reconciler chạy. Mọi bản ghi PENDING quá hạn
 * đều giữ nguyên trạng thái đó suốt bài test — nếu hiển thị vẫn đúng thì tính
 * đúng đắn thật sự đã tách khỏi cron.
 */
const NOW = new Date('2026-08-20T01:00:00.000Z'); // 08:00 giờ VN
const ONE_HOUR = 60 * 60 * 1000;
const PAST = new Date(NOW.getTime() - ONE_HOUR);
const FUTURE = new Date(NOW.getTime() + ONE_HOUR);

describe('NewsService — hiển thị công khai của bài lên lịch', () => {
  let service: NewsService;
  let prisma: {
    newsPost: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    newsCategory: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      newsPost: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      newsCategory: { findMany: jest.fn().mockResolvedValue([]) },
      // Giữ đúng ngữ nghĩa `$transaction([...])` của Prisma: chờ mọi promise.
      $transaction: jest.fn((operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [NewsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(NewsService);

    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Điều kiện `where` mà service đã gửi xuống Prisma ở lời gọi findMany đầu. */
  function listWhere(): { OR?: unknown } {
    const [args] = prisma.newsPost.findMany.mock.calls[0] as [
      { where?: { OR?: unknown } },
    ];
    return args.where ?? {};
  }

  describe('danh sách công khai', () => {
    it('lọc theo luật hiển thị dùng chung, không phải `status = PUBLISHED`', async () => {
      await service.findAll(true);

      expect(listWhere()).toEqual({
        OR: [
          { status: ContentStatus.PUBLISHED },
          {
            status: ContentStatus.PENDING,
            scheduledAt: { not: null, lte: NOW },
          },
        ],
      });
    });

    it('danh sách Admin KHÔNG bị lọc — bài nháp và bài đã hẹn vẫn thấy', async () => {
      await service.findAll(false);

      const [args] = prisma.newsPost.findMany.mock.calls[0] as [
        { where?: unknown },
      ];
      expect(args.where).toBeUndefined();
    });
  });

  describe('phân trang công khai', () => {
    it('`count` và `findMany` dùng CÙNG một điều kiện và CÙNG một mốc `now`', async () => {
      await service.findAllPaginated(1, 9);

      const [countArgs] = prisma.newsPost.count.mock.calls[0] as [
        { where: unknown },
      ];
      const [listArgs] = prisma.newsPost.findMany.mock.calls[0] as [
        { where: unknown },
      ];

      // Bất đồng ở đây nghĩa là `totalItems` đếm một tập, còn `items` trả một
      // tập khác — phân trang sẽ nhảy bài đúng tại giây đáo hạn.
      expect(countArgs.where).toEqual(listArgs.where);
      expect(countArgs.where).toMatchObject({
        OR: [
          { status: ContentStatus.PUBLISHED },
          {
            status: ContentStatus.PENDING,
            scheduledAt: { not: null, lte: NOW },
          },
        ],
      });
    });

    it('giữ nguyên bộ lọc chuyên mục bên cạnh luật hiển thị', async () => {
      await service.findAllPaginated(1, 9, 'tin-du-an');

      const [listArgs] = prisma.newsPost.findMany.mock.calls[0] as [
        { where: { OR?: unknown; category?: unknown } },
      ];
      expect(listArgs.where.category).toEqual({ slug: 'tin-du-an' });
      expect(listArgs.where.OR).toBeDefined();
    });

    it('bài đã tới hạn được tính vào cả `items` lẫn `totalItems`', async () => {
      const duePost = {
        id: 'n1',
        slug: 'bai-den-han',
        status: ContentStatus.PENDING,
        scheduledAt: PAST,
        publishedAt: PAST,
      };
      prisma.newsPost.count.mockResolvedValue(1);
      prisma.newsPost.findMany.mockResolvedValue([duePost]);

      const page = await service.findAllPaginated(1, 9);

      expect(page.totalItems).toBe(1);
      expect(page.totalPages).toBe(1);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({ slug: 'bai-den-han' });
    });

    it('giữ nguyên hình dạng response và transaction', async () => {
      const page = await service.findAllPaginated(2, 9);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(page).toMatchObject({
        page: 2,
        limit: 9,
        totalItems: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: true,
      });
    });
  });

  describe('chi tiết công khai theo slug', () => {
    /** [nhãn, trạng thái, lịch, có trả về không] */
    const cases: Array<[string, ContentStatus, Date | null, boolean]> = [
      ['PUBLISHED', ContentStatus.PUBLISHED, null, true],
      ['PENDING + lịch tương lai', ContentStatus.PENDING, FUTURE, false],
      ['PENDING + lịch đã tới hạn', ContentStatus.PENDING, PAST, true],
      ['PENDING không có lịch', ContentStatus.PENDING, null, false],
      ['DRAFT + lịch quá hạn (dị dạng)', ContentStatus.DRAFT, PAST, false],
      ['DRAFT', ContentStatus.DRAFT, null, false],
    ];

    it.each(cases)('%s', async (_label, status, scheduledAt, visible) => {
      prisma.newsPost.findUnique.mockResolvedValue({
        id: 'n1',
        slug: 'bai-viet',
        status,
        scheduledAt,
      });

      const result = service.findBySlug('bai-viet', true);

      if (visible) {
        await expect(result).resolves.toMatchObject({ slug: 'bai-viet' });
      } else {
        await expect(result).rejects.toThrow(NotFoundException);
      }
    });

    it('bài hẹn tương lai trả 404 GIỐNG HỆT bài không tồn tại — không lộ lịch', async () => {
      prisma.newsPost.findUnique.mockResolvedValue({
        id: 'n1',
        slug: 'bai-sap-dang',
        status: ContentStatus.PENDING,
        scheduledAt: FUTURE,
      });
      const scheduled = await service
        .findBySlug('bai-sap-dang', true)
        .catch((error: NotFoundException) => error);

      prisma.newsPost.findUnique.mockResolvedValue(null);
      const missing = await service
        .findBySlug('khong-co-that', true)
        .catch((error: NotFoundException) => error);

      // Cùng lớp lỗi, cùng nguyên văn thông báo: không suy ra được bài nào tồn
      // tại mà đang chờ giờ đăng.
      expect(scheduled).toBeInstanceOf(NotFoundException);
      expect((scheduled as NotFoundException).message).toBe(
        (missing as NotFoundException).message,
      );
    });

    it('không rò `scheduledAt` qua phản hồi lỗi', async () => {
      prisma.newsPost.findUnique.mockResolvedValue({
        id: 'n1',
        slug: 'bai-sap-dang',
        status: ContentStatus.PENDING,
        scheduledAt: FUTURE,
      });

      const error = await service
        .findBySlug('bai-sap-dang', true)
        .catch((caught: NotFoundException) => caught);

      expect(
        JSON.stringify((error as NotFoundException).getResponse()),
      ).not.toContain('2026');
    });

    it('route Admin (`publishedOnly = false`) vẫn đọc được bài đã hẹn', async () => {
      prisma.newsPost.findUnique.mockResolvedValue({
        id: 'n1',
        slug: 'bai-sap-dang',
        status: ContentStatus.PENDING,
        scheduledAt: FUTURE,
      });

      await expect(service.findBySlug('bai-sap-dang')).resolves.toMatchObject({
        slug: 'bai-sap-dang',
      });
    });
  });

  describe('độc lập với reconciler', () => {
    it('bài PENDING quá hạn là công khai dù scheduler CHƯA hề chạy', async () => {
      // Không có lời gọi nào tới NewsSchedulerService trong bài test này, và
      // `status` giữ nguyên PENDING từ đầu tới cuối. Đây là khẳng định trung
      // tâm của batch: tính đúng đắn không còn phụ thuộc cron.
      prisma.newsPost.findUnique.mockResolvedValue({
        id: 'n1',
        slug: 'bai-den-han',
        status: ContentStatus.PENDING,
        scheduledAt: PAST,
      });

      const post = await service.findBySlug('bai-den-han', true);

      expect(post).toMatchObject({ status: ContentStatus.PENDING });
    });

    it('đọc công khai KHÔNG ghi gì xuống database', async () => {
      prisma.newsPost.findUnique.mockResolvedValue({
        id: 'n1',
        slug: 'bai-den-han',
        status: ContentStatus.PENDING,
        scheduledAt: PAST,
      });

      await service.findBySlug('bai-den-han', true);
      await service.findAll(true);
      await service.findAllPaginated(1, 9);

      // Không "sửa trạng thái nhân tiện lúc đọc": GET phải là read-only, nếu
      // không mỗi lượt truy cập thành một lượt ghi và đua nhau ở giây đáo hạn.
      expect(prisma.newsPost.update).not.toHaveBeenCalled();
      expect(prisma.newsPost.updateMany).not.toHaveBeenCalled();
    });
  });
});
