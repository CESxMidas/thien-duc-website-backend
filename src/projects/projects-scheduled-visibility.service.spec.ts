import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  isProjectPubliclyVisible,
  projectPubliclyVisibleWhere,
} from '../common/publication';
import { ProjectsService } from './projects.service';

/**
 * **Batch 9 — dự án đã tới hạn lên lịch phải công khai NGAY, không đợi cron.**
 *
 * Đây là lý do vị từ hiển thị tồn tại. Trên Render Free backend ngủ sau 15 phút
 * không có traffic — với một website doanh nghiệp ít lượt truy cập thì ngủ là
 * trạng thái *bình thường*, nên lượt cron lúc 08:00 có thể không bao giờ chạy.
 * Đánh giá điều kiện **lúc truy vấn** làm tính đúng đắn hết phụ thuộc vào cron:
 * request đầu tiên sau giờ hẹn đã thấy dự án, kể cả khi tiến trình vừa thức dậy.
 *
 * Ma trận dưới đây chạy trên **cùng một vị từ** mà service dùng thật, ở cả hai
 * dạng của nó: vị từ trên bản ghi đã nạp (chi tiết) và mảnh `where` của Prisma
 * (danh sách).
 */

const NOW = new Date('2026-08-13T10:00:00.000Z');
const FUTURE = new Date('2026-08-20T01:00:00.000Z');
const PAST = new Date('2026-08-13T09:00:00.000Z');

/** Sáu trạng thái, mô tả bằng đúng hai cột quyết định hiển thị. */
const states = {
  'nháp sạch': {
    contentStatus: ContentStatus.DRAFT,
    scheduledAt: null,
    publishedAt: null,
  },
  'chờ duyệt, chưa hẹn giờ': {
    contentStatus: ContentStatus.PENDING,
    scheduledAt: null,
    publishedAt: null,
  },
  'đã lên lịch (chưa tới hạn)': {
    contentStatus: ContentStatus.PENDING,
    scheduledAt: FUTURE,
    publishedAt: FUTURE,
  },
  'lịch ĐÚNG giây đáo hạn': {
    contentStatus: ContentStatus.PENDING,
    scheduledAt: NOW,
    publishedAt: NOW,
  },
  'lịch đã qua, chưa đồng bộ': {
    contentStatus: ContentStatus.PENDING,
    scheduledAt: PAST,
    publishedAt: PAST,
  },
  'đang đăng': {
    contentStatus: ContentStatus.PUBLISHED,
    scheduledAt: null,
    publishedAt: PAST,
  },
  'DỊ DẠNG: nháp + lịch quá khứ': {
    contentStatus: ContentStatus.DRAFT,
    scheduledAt: PAST,
    publishedAt: null,
  },
} as const;

type StateKey = keyof typeof states;

/** Trạng thái nào PHẢI hiển thị công khai. */
const PUBLIC: StateKey[] = [
  'lịch ĐÚNG giây đáo hạn',
  'lịch đã qua, chưa đồng bộ',
  'đang đăng',
];

const PRIVATE: StateKey[] = [
  'nháp sạch',
  'chờ duyệt, chưa hẹn giờ',
  'đã lên lịch (chưa tới hạn)',
  'DỊ DẠNG: nháp + lịch quá khứ',
];

describe('Vị từ hiển thị công khai của dự án', () => {
  it.each(PUBLIC)('%s → CÔNG KHAI', (key) => {
    expect(isProjectPubliclyVisible(states[key], NOW)).toBe(true);
  });

  it.each(PRIVATE)('%s → RIÊNG TƯ', (key) => {
    expect(isProjectPubliclyVisible(states[key], NOW)).toBe(false);
  });

  /**
   * Ca dị dạng là chốt bảo mật, không phải trường hợp lý thuyết: nếu vị từ được
   * viết gọn thành `scheduled_at <= now` (bỏ ràng buộc PENDING) thì một hàng
   * `DRAFT` mang lịch quá khứ — dữ liệu cũ, hoặc lỗi tương lai — sẽ lọt thẳng ra
   * website. Rủi ro của việc bỏ sót phải là "hiện muộn", không phải "rò rỉ sớm".
   */
  it('nhánh lịch của mảnh `where` LUÔN kèm ràng buộc PENDING', () => {
    const where = projectPubliclyVisibleWhere(NOW) as {
      OR: { contentStatus: ContentStatus; scheduledAt?: unknown }[];
    };

    expect(where.OR).toHaveLength(2);
    expect(where.OR[0]).toEqual({ contentStatus: ContentStatus.PUBLISHED });
    expect(where.OR[1]).toEqual({
      contentStatus: ContentStatus.PENDING,
      scheduledAt: { not: null, lte: NOW },
    });
  });
});

describe('ProjectsService — route công khai theo lịch', () => {
  let service: ProjectsService;
  let prisma: {
    project: { findUnique: jest.Mock; findMany: jest.Mock };
    projectItem: { findFirst: jest.Mock };
    projectGalleryImage: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(NOW);

    prisma = {
      project: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      projectItem: { findFirst: jest.fn().mockResolvedValue({ id: 'item-1' }) },
      projectGalleryImage: {
        findMany: jest.fn().mockResolvedValue([{ id: 'img-1' }]),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(ProjectsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function given(key: StateKey) {
    prisma.project.findUnique.mockResolvedValue({
      id: 'p1',
      slug: 'du-an',
      ...states[key],
      items: [],
      galleryImages: [],
    });
  }

  describe('danh sách công khai', () => {
    it('lọc bằng vị từ hiển thị, không phải một giá trị enum', async () => {
      await service.findAll(true);

      const [{ where }] = prisma.project.findMany.mock.calls[0] as [
        { where?: Prisma.ProjectWhereInput },
      ];
      expect(where).toEqual(projectPubliclyVisibleWhere(NOW));
    });

    it('route Admin vẫn thấy MỌI trạng thái', async () => {
      await service.findAll(false);

      const [{ where }] = prisma.project.findMany.mock.calls[0] as [
        { where?: unknown },
      ];
      expect(where).toBeUndefined();
    });
  });

  describe('chi tiết công khai', () => {
    it.each(PUBLIC)('%s → trả về dự án', async (key) => {
      given(key);

      await expect(service.findBySlug('du-an', true)).resolves.toMatchObject({
        slug: 'du-an',
      });
    });

    /**
     * Dự án chưa tới hạn ném **đúng** `NotFoundException` như dự án nháp: không
     * mã lỗi riêng, không "sắp ra mắt", không lộ `scheduledAt`. Người ngoài
     * không được phân biệt "không tồn tại" với "sắp công khai".
     */
    it.each(PRIVATE)('%s → 404 y như không tồn tại', async (key) => {
      given(key);

      await expect(service.findBySlug('du-an', true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('route Admin vẫn xem được dự án đang hẹn giờ', async () => {
      given('đã lên lịch (chưa tới hạn)');

      await expect(service.findBySlug('du-an', false)).resolves.toMatchObject({
        contentStatus: ContentStatus.PENDING,
      });
    });
  });

  /**
   * §23 — nội dung con thừa hưởng khả năng hiển thị của cha. Hai route công khai
   * của hạng mục/thư viện đều đi qua `findBySlug(..., true)`, nên chúng dùng
   * chung đúng một vị từ: không có đường vòng nào đọc được nội dung con của một
   * dự án chưa tới hạn.
   */
  describe('nội dung con thừa hưởng hiển thị của cha', () => {
    it('cha chưa tới hạn → thư viện ảnh công khai trả 404', async () => {
      given('đã lên lịch (chưa tới hạn)');

      await expect(service.findGallery('du-an', true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('cha chưa tới hạn → chi tiết hạng mục công khai trả 404', async () => {
      given('đã lên lịch (chưa tới hạn)');

      await expect(
        service.findItemBySlug('du-an', 'hang-muc', true),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('cha ĐÃ tới hạn → nội dung con hiện ra cùng cha', async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: 'p1',
        slug: 'du-an',
        ...states['lịch đã qua, chưa đồng bộ'],
        items: [],
        galleryImages: [{ id: 'img-1' }],
      });

      await expect(service.findGallery('du-an', true)).resolves.toBeDefined();
    });
  });
});
