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
   * c1: 2 đã đăng + 1 nháp = 3
   * c2: không có bài nào
   * c3: 4 nháp + 1 chờ duyệt = 5, chưa bài nào đăng
   * (kèm một nhóm `categoryId: null` — bài chưa phân loại, không thuộc chuyên mục nào)
   */
  const groupRows = [
    { categoryId: 'c1', status: ContentStatus.PUBLISHED, _count: { _all: 2 } },
    { categoryId: 'c1', status: ContentStatus.DRAFT, _count: { _all: 1 } },
    { categoryId: 'c3', status: ContentStatus.DRAFT, _count: { _all: 4 } },
    { categoryId: 'c3', status: ContentStatus.PENDING, _count: { _all: 1 } },
    { categoryId: null, status: ContentStatus.PUBLISHED, _count: { _all: 7 } },
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
        groupBy: jest.fn().mockResolvedValue(groupRows),
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

    it('publishedCount chỉ đếm bài PUBLISHED, bỏ qua nháp và chờ duyệt', async () => {
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

    it('chỉ MỘT truy vấn đếm cho cả danh sách — không N+1', async () => {
      await service.findAllCategories(true);

      expect(prisma.newsPost.groupBy).toHaveBeenCalledTimes(1);
      const [args] = prisma.newsPost.groupBy.mock.calls[0] as [{ by: unknown }];
      expect(args.by).toEqual(['categoryId', 'status']);
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
