import { Test } from '@nestjs/testing';
import { ContentStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NewsService } from './news.service';

/** Mốc cố định: 08:00 giờ VN. Test không phụ thuộc đồng hồ thật. */
const NOW = new Date('2026-08-20T01:00:00.000Z');

/**
 * Điều kiện hiển thị công khai mà service gửi xuống Prisma. Từ Batch 2 nó không
 * còn là `status = PUBLISHED` mà là luật dùng chung ở `common/publication.ts`:
 * bài đã đăng, HOẶC bài chờ duyệt đã tới hạn lên lịch.
 */
function publiclyVisible(now: Date) {
  return {
    OR: [
      { status: ContentStatus.PUBLISHED },
      { status: ContentStatus.PENDING, scheduledAt: { not: null, lte: now } },
    ],
  };
}

/**
 * THIEN-DUC-NEWS-SLIDER-AND-PAGINATION-M1 — hợp đồng phân trang của
 * `GET /news?page&limit`.
 *
 * Test ở tầng service với Prisma giả: khẳng định **truy vấn gửi xuống DB**
 * (where/orderBy/skip/take) và **metadata trả ra**. Phần ràng buộc giá trị
 * page/limit do `QueryNewsDto` + ValidationPipe lo, được kiểm ở e2e.
 */
describe('NewsService.findAllPaginated', () => {
  let service: NewsService;
  let prisma: {
    newsPost: { count: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  /** Trả về đối số Prisma nhận được cho `count` và `findMany`. */
  function queries() {
    const [countArgs] = prisma.newsPost.count.mock.calls[0] as [
      { where: unknown },
    ];
    const [findArgs] = prisma.newsPost.findMany.mock.calls[0] as [
      { where: unknown; orderBy: unknown; skip: number; take: number },
    ];
    return { countArgs, findArgs };
  }

  beforeEach(async () => {
    prisma = {
      newsPost: { count: jest.fn(), findMany: jest.fn() },
      // `$transaction([...])` nhận mảng promise và trả mảng kết quả — Prisma giả
      // chỉ cần chờ đúng thứ tự đó.
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

  it('chỉ lấy bài PUBLISHED, mới nhất trước, có khoá phụ id desc', async () => {
    prisma.newsPost.count.mockResolvedValue(0);
    prisma.newsPost.findMany.mockResolvedValue([]);

    await service.findAllPaginated(1, 9);
    const { countArgs, findArgs } = queries();

    expect(countArgs.where).toEqual(publiclyVisible(NOW));
    expect(findArgs.where).toEqual(publiclyVisible(NOW));
    expect(findArgs.orderBy).toEqual([{ publishedAt: 'desc' }, { id: 'desc' }]);
  });

  it('đếm và lấy trang chạy trong cùng một transaction', async () => {
    prisma.newsPost.count.mockResolvedValue(0);
    prisma.newsPost.findMany.mockResolvedValue([]);

    await service.findAllPaginated(1, 9);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('skip/take suy ra từ page và limit', async () => {
    prisma.newsPost.count.mockResolvedValue(30);
    prisma.newsPost.findMany.mockResolvedValue([]);

    await service.findAllPaginated(3, 9);
    const { findArgs } = queries();

    expect(findArgs.skip).toBe(18);
    expect(findArgs.take).toBe(9);
  });

  it('trang 1: totalPages làm tròn lên, hasNextPage true, hasPreviousPage false', async () => {
    prisma.newsPost.count.mockResolvedValue(20);
    prisma.newsPost.findMany.mockResolvedValue(Array(9).fill({ id: 'x' }));

    const result = await service.findAllPaginated(1, 9);

    expect(result.totalItems).toBe(20);
    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(9);
    expect(result.hasPreviousPage).toBe(false);
    expect(result.hasNextPage).toBe(true);
  });

  it('trang cuối: số bài ít hơn limit, hasNextPage false', async () => {
    prisma.newsPost.count.mockResolvedValue(20);
    prisma.newsPost.findMany.mockResolvedValue(Array(2).fill({ id: 'x' }));

    const result = await service.findAllPaginated(3, 9);

    expect(result.items).toHaveLength(2);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(true);
  });

  it('không có bài nào: totalPages = 0, không còn trang trước/sau', async () => {
    prisma.newsPost.count.mockResolvedValue(0);
    prisma.newsPost.findMany.mockResolvedValue([]);

    const result = await service.findAllPaginated(1, 9);

    expect(result.items).toEqual([]);
    expect(result.totalItems).toBe(0);
    expect(result.totalPages).toBe(0);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(false);
  });

  it('trang vượt quá cuối danh sách: rỗng, hasNextPage false (không ném lỗi)', async () => {
    prisma.newsPost.count.mockResolvedValue(20);
    prisma.newsPost.findMany.mockResolvedValue([]);

    const result = await service.findAllPaginated(99, 9);

    expect(result.items).toEqual([]);
    expect(result.page).toBe(99);
    expect(result.totalPages).toBe(3);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(true);
  });

  it('tổng chia hết cho limit: không sinh thừa một trang rỗng', async () => {
    prisma.newsPost.count.mockResolvedValue(18);
    prisma.newsPost.findMany.mockResolvedValue(Array(9).fill({ id: 'x' }));

    const result = await service.findAllPaginated(2, 9);

    expect(result.totalPages).toBe(2);
    expect(result.hasNextPage).toBe(false);
  });
});

describe('NewsService.findAll (danh sách phẳng, giữ tương thích)', () => {
  let service: NewsService;
  let prisma: { newsPost: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { newsPost: { findMany: jest.fn().mockResolvedValue([]) } };
    const moduleRef = await Test.createTestingModule({
      providers: [NewsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(NewsService);
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('route công khai: chỉ PUBLISHED, publishedAt desc + id desc', async () => {
    await service.findAll(true);
    const [args] = prisma.newsPost.findMany.mock.calls[0] as [
      { where: unknown; orderBy: unknown },
    ];

    expect(args.where).toEqual(publiclyVisible(NOW));
    expect(args.orderBy).toEqual([{ publishedAt: 'desc' }, { id: 'desc' }]);
  });

  it('route admin: không lọc trạng thái, updatedAt desc + id desc', async () => {
    await service.findAll(false);
    const [args] = prisma.newsPost.findMany.mock.calls[0] as [
      { where: unknown; orderBy: unknown },
    ];

    expect(args.where).toBeUndefined();
    expect(args.orderBy).toEqual([{ updatedAt: 'desc' }, { id: 'desc' }]);
  });
});
