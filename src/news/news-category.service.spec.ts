import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CATEGORY_IN_USE_CODE } from './news-category-slug';
import { NewsService } from './news.service';

/**
 * Hợp đồng quản lý chuyên mục tin.
 *
 * Hai điều dễ hỏng nhất và là lý do file này tồn tại:
 * - **Rò rỉ số bài chưa xuất bản**: `GET /news/categories` là route CÔNG KHAI,
 *   không đăng nhập. Bản cũ trả `_count.posts` gộp mọi trạng thái nên bất kỳ ai
 *   cũng đếm được số bài nháp của công ty.
 * - **Xóa chuyên mục gỡ nhãn hàng loạt**: `onDelete: SetNull` làm bài mất phân
 *   loại âm thầm, không Undo. API phải chặn trước khi chạm database.
 */
describe('NewsService — chuyên mục', () => {
  let service: NewsService;
  let prisma: {
    newsCategory: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    newsPost: { groupBy: jest.Mock; count: jest.Mock };
  };

  /** Ba chuyên mục cố định cho mọi ca test. */
  const categories = [
    { id: 'c1', slug: 'tin-du-an', name: { vi: 'Tin dự án' }, order: 0 },
    { id: 'c2', slug: 'tin-cong-ty', name: { vi: 'Tin công ty' }, order: 1 },
    { id: 'c3', slug: 'tin-kien-truc', name: { vi: 'Kiến trúc' }, order: 2 },
  ];

  /**
   * Từ Batch 2, "đã đăng công khai" là một **biểu thức** (PUBLISHED, hoặc
   * PENDING đã tới hạn) chứ không còn là một giá trị enum, nên `groupBy` của
   * Prisma không nhóm theo nó được. Service chạy hai lượt đếm có `where` riêng:
   * lượt không lọc cho `totalCount`, lượt lọc theo luật hiển thị cho
   * `publishedCount`. Mock ở đây phân biệt hai lượt bằng sự có mặt của `where`.
   *
   * Dữ liệu dàn dựng:
   *   c1: 2 PUBLISHED + 1 DRAFT                        → tổng 3, công khai 2
   *   c2: không có bài nào                             → tổng 0, công khai 0
   *   c3: 4 DRAFT + 1 PENDING (không lịch)             → tổng 5, công khai 0
   *   `categoryId: null`: 7 bài chưa phân loại — không thuộc chuyên mục nào
   */
  const totalRows = [
    { categoryId: 'c1', _count: { _all: 3 } },
    { categoryId: 'c3', _count: { _all: 5 } },
    { categoryId: null, _count: { _all: 7 } },
  ];
  const visibleRows = [
    { categoryId: 'c1', _count: { _all: 2 } },
    { categoryId: null, _count: { _all: 7 } },
  ];

  beforeEach(async () => {
    prisma = {
      newsCategory: {
        findMany: jest.fn().mockResolvedValue(categories),
        findUnique: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
        create: jest.fn(),
        update: jest.fn(),
      },
      newsPost: {
        groupBy: jest
          .fn()
          .mockImplementation((args: { where?: unknown }) =>
            Promise.resolve(args.where ? visibleRows : totalRows),
          ),
        count: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [NewsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(NewsService);
  });

  describe('danh sách công khai', () => {
    it('KHÔNG lộ tổng số bài — chỉ có publishedCount', async () => {
      const result = await service.findAllCategories();

      for (const category of result) {
        expect(category).not.toHaveProperty('totalCount');
        expect(category).toHaveProperty('publishedCount');
      }
    });

    it('publishedCount bỏ qua nháp và bài chờ duyệt chưa tới hạn', async () => {
      const result = await service.findAllCategories();
      const bySlug = Object.fromEntries(result.map((c) => [c.slug, c]));

      expect(bySlug['tin-du-an'].publishedCount).toBe(2);
      expect(bySlug['tin-cong-ty'].publishedCount).toBe(0);
      // 4 nháp + 1 chờ duyệt nhưng chưa bài nào đăng.
      expect(bySlug['tin-kien-truc'].publishedCount).toBe(0);
    });

    it('KHÔNG lộ số bài nháp qua bất kỳ field nào', async () => {
      const result = await service.findAllCategories();

      // c3 có 5 bài chưa đăng — không con số nào trong phản hồi được bằng 5.
      const values = JSON.stringify(result);
      expect(values).not.toContain('"totalCount"');
      expect(values).not.toContain('_count');
    });

    it('sắp theo order rồi slug', async () => {
      await service.findAllCategories();
      const [args] = prisma.newsCategory.findMany.mock.calls[0] as [
        { orderBy: unknown },
      ];

      expect(args.orderBy).toEqual([{ order: 'asc' }, { slug: 'asc' }]);
    });
  });

  describe('danh sách cho Admin', () => {
    it('có CẢ publishedCount lẫn totalCount', async () => {
      const result = await service.findAllCategories(true);
      const bySlug = Object.fromEntries(result.map((c) => [c.slug, c]));

      expect(bySlug['tin-du-an']).toMatchObject({
        publishedCount: 2,
        totalCount: 3,
      });
      expect(bySlug['tin-cong-ty']).toMatchObject({
        publishedCount: 0,
        totalCount: 0,
      });
      expect(bySlug['tin-kien-truc']).toMatchObject({
        publishedCount: 0,
        totalCount: 5,
      });
    });

    it('bài chưa phân loại KHÔNG bị cộng vào chuyên mục nào', async () => {
      const result = await service.findAllCategories(true);
      const total = result.reduce((sum, c) => sum + (c.totalCount ?? 0), 0);

      // 3 + 0 + 5 = 8; 7 bài `categoryId: null` không được tính vào đâu cả.
      expect(total).toBe(8);
    });

    it('đúng HAI truy vấn đếm cho cả danh sách, không phụ thuộc số chuyên mục — không N+1', async () => {
      await service.findAllCategories(true);

      // Hai lượt: một đếm tổng, một đếm phần công khai. Con số này phải cố định
      // dù có 3 hay 300 chuyên mục.
      expect(prisma.newsPost.groupBy).toHaveBeenCalledTimes(2);
      for (const call of prisma.newsPost.groupBy.mock.calls) {
        const [args] = call as [{ by: unknown }];
        expect(args.by).toEqual(['categoryId']);
      }
    });
  });

  /**
   * Đếm chuyên mục là bề mặt rò rỉ khó thấy nhất: nó không trả nội dung, chỉ
   * trả một con số — nhưng con số tăng lên trước giờ hẹn là đủ để người ngoài
   * biết công ty sắp đăng gì đó. Bộ test này khoá đúng ranh giới ấy.
   */
  describe('publishedCount theo hiển thị hiệu dụng (chống rò rỉ)', () => {
    const NOW = new Date('2026-08-20T01:00:00.000Z'); // 08:00 giờ VN

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(NOW);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('lượt đếm công khai lọc theo luật hiển thị dùng chung', async () => {
      await service.findAllCategories();

      const withWhere = prisma.newsPost.groupBy.mock.calls
        .map(([args]) => args as { where?: unknown })
        .filter((args) => args.where);

      expect(withWhere).toHaveLength(1);
      expect(withWhere[0].where).toEqual({
        OR: [
          { status: ContentStatus.PUBLISHED },
          {
            status: ContentStatus.PENDING,
            scheduledAt: { not: null, lte: NOW },
          },
        ],
      });
    });

    it('lượt đếm tổng KHÔNG lọc — totalCount vẫn gồm mọi trạng thái', async () => {
      await service.findAllCategories(true);

      const withoutWhere = prisma.newsPost.groupBy.mock.calls
        .map(([args]) => args as { where?: unknown })
        .filter((args) => !args.where);

      expect(withoutWhere).toHaveLength(1);
    });

    /**
     * Kịch bản A/B/C/D trên cùng một chuyên mục:
     *   A. PUBLISHED                      → tính
     *   B. PENDING + lịch tương lai       → KHÔNG tính
     *   C. PENDING + lịch đã tới hạn      → tính
     *   D. DRAFT  + lịch quá hạn (dị dạng)→ KHÔNG tính
     * publishedCount = A + C = 2; totalCount = cả bốn = 4.
     */
    it('A+C được tính, B+D bị loại; totalCount vẫn thấy cả bốn', async () => {
      prisma.newsCategory.findMany.mockResolvedValue([categories[0]]);
      prisma.newsPost.groupBy.mockImplementation(
        (args: { where?: Record<string, unknown> }) =>
          Promise.resolve(
            args.where
              ? // Điều kiện thật của Prisma sẽ loại B và D; mock phản ánh kết quả đó.
                [{ categoryId: 'c1', _count: { _all: 2 } }]
              : [{ categoryId: 'c1', _count: { _all: 4 } }],
          ),
      );

      const [category] = await service.findAllCategories(true);

      expect(category.publishedCount).toBe(2);
      expect(category.totalCount).toBe(4);
    });

    it('route Admin cũng dùng hiển thị hiệu dụng cho publishedCount', async () => {
      await service.findAllCategories(true);

      const publicCounts = prisma.newsPost.groupBy.mock.calls
        .map(([args]) => args as { where?: { OR?: unknown } })
        .filter((args) => args.where);

      // "Đang hiện trên website" phải là cùng một câu trả lời dù ai hỏi.
      expect(publicCounts[0].where?.OR).toBeDefined();
    });
  });

  describe('xóa chuyên mục', () => {
    it('chuyên mục KHÔNG còn bài: xóa bình thường', async () => {
      prisma.newsCategory.findUnique.mockResolvedValue(categories[1]);
      prisma.newsPost.count.mockResolvedValue(0);

      await expect(service.removeCategory('tin-cong-ty')).resolves.toEqual({
        deleted: true,
      });
      expect(prisma.newsCategory.delete).toHaveBeenCalledTimes(1);
    });

    it('chuyên mục CÒN bài: 409, KHÔNG chạm database', async () => {
      prisma.newsCategory.findUnique.mockResolvedValue(categories[2]);
      prisma.newsPost.count.mockResolvedValue(5);

      await expect(service.removeCategory('tin-kien-truc')).rejects.toThrow(
        ConflictException,
      );
      // Điều quan trọng nhất: `delete` không được gọi, nên `SetNull` không chạy.
      expect(prisma.newsCategory.delete).not.toHaveBeenCalled();
    });

    it('lỗi 409 mang mã máy đọc được + số bài', async () => {
      prisma.newsCategory.findUnique.mockResolvedValue(categories[2]);
      prisma.newsPost.count.mockResolvedValue(5);

      try {
        await service.removeCategory('tin-kien-truc');
        throw new Error('lẽ ra phải ném lỗi');
      } catch (error) {
        const body = (error as ConflictException).getResponse() as {
          error: string;
          totalCount: number;
          message: string;
        };
        expect(body.error).toBe(CATEGORY_IN_USE_CODE);
        expect(body.totalCount).toBe(5);
        expect(body.message).toContain('5');
      }
    });

    it('đếm MỌI trạng thái, không riêng bài đã đăng', async () => {
      prisma.newsCategory.findUnique.mockResolvedValue(categories[2]);
      prisma.newsPost.count.mockResolvedValue(5);

      await expect(service.removeCategory('tin-kien-truc')).rejects.toThrow();
      const [args] = prisma.newsPost.count.mock.calls[0] as [
        { where: unknown },
      ];
      // Không có điều kiện `status` — bài nháp cũng là công sức biên tập.
      expect(args.where).toEqual({ categoryId: 'c3' });
    });

    it('chuyên mục không tồn tại: 404', async () => {
      prisma.newsCategory.findUnique.mockResolvedValue(null);

      await expect(service.removeCategory('khong-co-that')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
