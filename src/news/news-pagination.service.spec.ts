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

function row(
  id: string,
  {
    order = 0,
    eventDate = null,
    publishedAt = null,
    createdAt = '2026-01-01T00:00:00.000Z',
  }: {
    order?: number;
    eventDate?: string | null;
    publishedAt?: string | null;
    createdAt?: string;
  } = {},
) {
  return {
    id,
    order,
    eventDate: eventDate ? new Date(eventDate) : null,
    publishedAt: publishedAt ? new Date(publishedAt) : null,
    createdAt: new Date(createdAt),
  };
}

function rows(count: number) {
  return Array.from({ length: count }, (_, index) =>
    row(`row-${String(index + 1).padStart(2, '0')}`, {
      publishedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    }),
  );
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
      { where: unknown; orderBy: unknown; skip?: number; take?: number },
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

  it('chỉ lấy bài công khai, ưu tiên thứ tự đã lưu rồi ngày tạo mới', async () => {
    prisma.newsPost.count.mockResolvedValue(0);
    prisma.newsPost.findMany.mockResolvedValue([]);

    await service.findAllPaginated(1, 9);
    const { countArgs, findArgs } = queries();

    expect(countArgs.where).toEqual({
      ...publiclyVisible(NOW),
      deletedAt: null,
    });
    expect(findArgs.where).toEqual({
      ...publiclyVisible(NOW),
      deletedAt: null,
    });
    expect(findArgs.orderBy).toEqual([
      { order: 'asc' },
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('đếm và lấy trang chạy trong cùng một transaction', async () => {
    prisma.newsPost.count.mockResolvedValue(0);
    prisma.newsPost.findMany.mockResolvedValue([]);

    await service.findAllPaginated(1, 9);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('cắt trang sau khi xếp theo thứ tự hiển thị, không lặp/lệch bài', async () => {
    prisma.newsPost.count.mockResolvedValue(30);
    prisma.newsPost.findMany.mockResolvedValue(rows(30));

    const result = await service.findAllPaginated(3, 9);
    const { findArgs } = queries();

    expect(findArgs.skip).toBeUndefined();
    expect(findArgs.take).toBeUndefined();
    expect(result.items.map((item) => item.id)).toEqual([
      'row-12',
      'row-11',
      'row-10',
      'row-09',
      'row-08',
      'row-07',
      'row-06',
      'row-05',
      'row-04',
    ]);
  });

  it('ưu tiên ngày tạo mới, không đưa ngày sự kiện lên trên thứ tự nội dung', async () => {
    prisma.newsPost.count.mockResolvedValue(4);
    prisma.newsPost.findMany.mockResolvedValue([
      row('created-fallback', {
        createdAt: '2026-08-10T00:00:00.000Z',
      }),
      row('published-fallback', {
        publishedAt: '2026-08-18T00:00:00.000Z',
        createdAt: '2026-10-01T00:00:00.000Z',
      }),
      row('event-wins', {
        eventDate: '2026-08-20T00:00:00.000Z',
        publishedAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      row('older-event', {
        eventDate: '2026-08-15T00:00:00.000Z',
        publishedAt: '2026-09-01T00:00:00.000Z',
        createdAt: '2026-09-01T00:00:00.000Z',
      }),
    ]);

    const result = await service.findAllPaginated(1, 9);

    expect(result.items.map((item) => item.id)).toEqual([
      'published-fallback',
      'older-event',
      'created-fallback',
      'event-wins',
    ]);
  });

  it('thứ tự do admin lưu được ưu tiên cao hơn ngày tạo và ngày sự kiện', async () => {
    prisma.newsPost.count.mockResolvedValue(2);
    prisma.newsPost.findMany.mockResolvedValue([
      row('newer', {
        order: 1,
        createdAt: '2026-10-01T00:00:00.000Z',
        eventDate: '2026-10-01T00:00:00.000Z',
      }),
      row('pinned-first', { order: 0, createdAt: '2020-01-01T00:00:00.000Z' }),
    ]);
    expect(
      (await service.findAllPaginated(1, 1)).items.map((item) => item.id),
    ).toEqual(['pinned-first']);
    expect(
      (await service.findAllPaginated(2, 1)).items.map((item) => item.id),
    ).toEqual(['newer']);
  });

  it('trang 1: totalPages làm tròn lên, hasNextPage true, hasPreviousPage false', async () => {
    prisma.newsPost.count.mockResolvedValue(20);
    prisma.newsPost.findMany.mockResolvedValue(rows(20));

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
    prisma.newsPost.findMany.mockResolvedValue(rows(20));

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
    prisma.newsPost.findMany.mockResolvedValue(rows(18));

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

  it('route công khai: chỉ bài công khai, ưu tiên bài mới tạo', async () => {
    prisma.newsPost.findMany.mockResolvedValue([
      row('published-fallback', { publishedAt: '2026-08-18T00:00:00.000Z' }),
      row('event-wins', { eventDate: '2026-08-20T00:00:00.000Z' }),
      row('created-fallback', { createdAt: '2026-08-10T00:00:00.000Z' }),
    ]);

    const result = await service.findAll(true);
    const [args] = prisma.newsPost.findMany.mock.calls[0] as [
      { where: unknown; orderBy: unknown },
    ];

    expect(args.where).toEqual({ ...publiclyVisible(NOW), deletedAt: null });
    expect(args.orderBy).toEqual([
      { order: 'asc' },
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
    expect(result.map((item) => item.id)).toEqual([
      'created-fallback',
      'published-fallback',
      'event-wins',
    ]);
  });

  it('route admin: không lọc trạng thái, dùng cùng thứ tự hiển thị với frontend', async () => {
    await service.findAll(false);
    const [args] = prisma.newsPost.findMany.mock.calls[0] as [
      { where: unknown; orderBy: unknown },
    ];

    expect(args.where).toEqual({ deletedAt: null });
    expect(args.orderBy).toEqual([
      { order: 'asc' },
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });
});
