import { Test } from '@nestjs/testing';
import { ContentStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NewsService } from './news.service';

/**
 * Hợp đồng lọc tin theo chuyên mục (`GET /news?page&limit&categorySlug`).
 *
 * Hai điều dễ hỏng nhất và là lý do file này tồn tại:
 * - **Rò nội dung chưa đăng**: mệnh đề chuyên mục được ghép THÊM vào điều kiện
 *   trạng thái, không được thay thế nó. Repo đã từng lộ bài DRAFT qua slug.
 * - **Slug lạ thành 500**: chuyên mục không tồn tại phải cho trang rỗng, vì URL
 *   chuyên mục là URL công khai và slug có thể bị đổi sau khi đã phát tán.
 *
 * Test ở tầng service với Prisma giả: khẳng định **truy vấn gửi xuống DB**, thứ
 * quyết định cả tính đúng lẫn việc index mới có được dùng hay không.
 */
describe('NewsService.findAllPaginated — lọc theo chuyên mục', () => {
  let service: NewsService;
  let prisma: {
    newsPost: { count: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };

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
      $transaction: jest.fn((operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [NewsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(NewsService);
  });

  it('không truyền categorySlug: truy vấn giữ nguyên như trước', async () => {
    prisma.newsPost.count.mockResolvedValue(0);
    prisma.newsPost.findMany.mockResolvedValue([]);

    await service.findAllPaginated(1, 9);
    const { countArgs, findArgs } = queries();

    expect(countArgs.where).toEqual({ status: ContentStatus.PUBLISHED });
    expect(findArgs.where).toEqual({ status: ContentStatus.PUBLISHED });
  });

  it('có categorySlug: lọc THÊM chuyên mục, KHÔNG bỏ điều kiện PUBLISHED', async () => {
    prisma.newsPost.count.mockResolvedValue(0);
    prisma.newsPost.findMany.mockResolvedValue([]);

    await service.findAllPaginated(1, 9, 'tin-du-an');
    const { countArgs, findArgs } = queries();

    const expected = {
      status: ContentStatus.PUBLISHED,
      category: { slug: 'tin-du-an' },
    };
    expect(countArgs.where).toEqual(expected);
    expect(findArgs.where).toEqual(expected);
  });

  it('đếm và lấy trang dùng CÙNG một điều kiện lọc', async () => {
    prisma.newsPost.count.mockResolvedValue(4);
    prisma.newsPost.findMany.mockResolvedValue([]);

    await service.findAllPaginated(1, 9, 'tin-noi-bo');
    const { countArgs, findArgs } = queries();

    // Lệch nhau thì `totalPages` tính trên tập này còn nội dung lấy từ tập kia.
    expect(countArgs.where).toEqual(findArgs.where);
  });

  it('giữ nguyên thứ tự và phân trang khi lọc chuyên mục', async () => {
    prisma.newsPost.count.mockResolvedValue(30);
    prisma.newsPost.findMany.mockResolvedValue([]);

    await service.findAllPaginated(3, 9, 'tin-du-an');
    const { findArgs } = queries();

    expect(findArgs.orderBy).toEqual([{ publishedAt: 'desc' }, { id: 'desc' }]);
    expect(findArgs.skip).toBe(18);
    expect(findArgs.take).toBe(9);
  });

  it('chuyên mục có thật nhưng chưa bài nào đăng: trang rỗng, không lỗi', async () => {
    prisma.newsPost.count.mockResolvedValue(0);
    prisma.newsPost.findMany.mockResolvedValue([]);

    const result = await service.findAllPaginated(1, 9, 'tin-tuyen-dung');

    expect(result.items).toEqual([]);
    expect(result.totalItems).toBe(0);
    expect(result.totalPages).toBe(0);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(false);
  });

  it('slug hợp lệ nhưng KHÔNG tồn tại: cũng chỉ là trang rỗng, không ném lỗi', async () => {
    prisma.newsPost.count.mockResolvedValue(0);
    prisma.newsPost.findMany.mockResolvedValue([]);

    await expect(
      service.findAllPaginated(1, 9, 'chuyen-muc-khong-co-that'),
    ).resolves.toMatchObject({ items: [], totalItems: 0, totalPages: 0 });
  });

  it('metadata phân trang vẫn đúng trên tập đã lọc', async () => {
    prisma.newsPost.count.mockResolvedValue(20);
    prisma.newsPost.findMany.mockResolvedValue(Array(9).fill({ id: 'x' }));

    const result = await service.findAllPaginated(2, 9, 'tin-du-an');

    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(2);
    expect(result.hasPreviousPage).toBe(true);
    expect(result.hasNextPage).toBe(true);
  });

  it('chuỗi rỗng KHÔNG được hiểu là "lọc theo chuyên mục rỗng"', async () => {
    prisma.newsPost.count.mockResolvedValue(0);
    prisma.newsPost.findMany.mockResolvedValue([]);

    await service.findAllPaginated(1, 9, '');
    const { findArgs } = queries();

    // `?categorySlug=` rỗng phải trả về danh sách đầy đủ, không phải khớp một
    // chuyên mục có slug là chuỗi rỗng (không bao giờ tồn tại → luôn rỗng).
    expect(findArgs.where).toEqual({ status: ContentStatus.PUBLISHED });
  });
});
