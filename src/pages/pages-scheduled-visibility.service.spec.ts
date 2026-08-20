import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  isPubliclyVisible,
  pagePubliclyVisibleWhere,
} from '../common/publication';
import { PagesService } from './pages.service';

/**
 * **Batch 11 — hiển thị công khai của trang là chuyện của LÚC TRUY VẤN.**
 *
 * Đây là lớp bảo đảm tính đúng đắn, không phải reconciler. Trên Render Free
 * backend ngủ sau 15 phút không traffic, nên lượt cron lúc 08:00 có thể không
 * bao giờ chạy — nhưng request đầu tiên sau giờ hẹn vẫn phải thấy trang.
 *
 * Trang có **HAI** đường công khai (`GET /pages` và `GET /pages/:slug`), nên cả
 * hai đều được kiểm ở đây: bỏ sót một đường là để lộ nội dung qua đoán slug.
 */

const NOW = new Date('2026-08-13T10:00:00.000Z');
const PAST = new Date('2026-08-13T09:00:00.000Z');
const FUTURE = new Date('2026-08-14T10:00:00.000Z');

const CASES: {
  label: string;
  status: ContentStatus;
  scheduledAt: Date | null;
  visible: boolean;
}[] = [
  {
    label: 'đã đăng',
    status: ContentStatus.PUBLISHED,
    scheduledAt: null,
    visible: true,
  },
  {
    label: 'hẹn giờ tương lai',
    status: ContentStatus.PENDING,
    scheduledAt: FUTURE,
    visible: false,
  },
  {
    label: 'lịch ĐÚNG giây đáo hạn',
    status: ContentStatus.PENDING,
    scheduledAt: NOW,
    visible: true,
  },
  {
    label: 'lịch đã qua, reconciler chưa chạy',
    status: ContentStatus.PENDING,
    scheduledAt: PAST,
    visible: true,
  },
  {
    label: 'chờ duyệt KHÔNG có lịch',
    status: ContentStatus.PENDING,
    scheduledAt: null,
    visible: false,
  },
  {
    label: 'DỊ DẠNG: nháp + lịch quá khứ',
    status: ContentStatus.DRAFT,
    scheduledAt: PAST,
    visible: false,
  },
  {
    label: 'nháp thường',
    status: ContentStatus.DRAFT,
    scheduledAt: null,
    visible: false,
  },
];

describe('Hiển thị công khai của trang nội dung', () => {
  describe('vị từ trên bản ghi đã nạp', () => {
    it.each(CASES)('$label → $visible', ({ status, scheduledAt, visible }) => {
      expect(isPubliclyVisible({ status, scheduledAt }, NOW)).toBe(visible);
    });
  });

  describe('mảnh `where` của Prisma', () => {
    it('đúng hai nhánh, nhánh lịch BẮT BUỘC kèm PENDING', () => {
      const where = pagePubliclyVisibleWhere(NOW);

      expect(where.OR).toHaveLength(2);
      expect(where.OR?.[0]).toEqual({ status: ContentStatus.PUBLISHED });
      expect(where.OR?.[1]).toEqual({
        status: ContentStatus.PENDING,
        scheduledAt: { not: null, lte: NOW },
      });
    });

    /**
     * Nếu vị từ rút gọn thành `status != DRAFT` thì trang chờ duyệt chưa hẹn giờ
     * sẽ lọt ra công khai. Khoá lại bằng hình dạng.
     */
    it('KHÔNG rút gọn thành `khác DRAFT`', () => {
      const where = pagePubliclyVisibleWhere(NOW);

      for (const branch of where.OR ?? []) {
        expect(typeof branch.status).toBe('string');
      }
      expect(where.OR?.map((branch) => branch.status)).toEqual([
        ContentStatus.PUBLISHED,
        ContentStatus.PENDING,
      ]);
    });
  });

  describe('hai đường công khai đi qua đúng vị từ đó', () => {
    let service: PagesService;
    let findMany: jest.Mock;
    let findUnique: jest.Mock;

    beforeEach(async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick'] });
      jest.setSystemTime(NOW);
      findMany = jest.fn().mockResolvedValue([]);
      findUnique = jest.fn();

      const moduleRef = await Test.createTestingModule({
        providers: [
          PagesService,
          {
            provide: PrismaService,
            useValue: { page: { findMany, findUnique } },
          },
        ],
      }).compile();

      service = moduleRef.get(PagesService);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('GET /pages dùng vị từ hiển thị, không hardcode PUBLISHED', async () => {
      await service.findAll(true);

      const [{ where }] = findMany.mock.calls[0] as [{ where: unknown }];
      expect(where).toEqual(pagePubliclyVisibleWhere(NOW));
    });

    it('danh sách Admin vẫn thấy mọi trạng thái', async () => {
      await service.findAll(false);

      const [{ where }] = findMany.mock.calls[0] as [{ where?: unknown }];
      expect(where).toBeUndefined();
    });

    it.each(CASES)(
      'GET /pages/:slug — $label → $visible',
      async ({ status, scheduledAt, visible }) => {
        findUnique.mockResolvedValue({
          id: 'g1',
          slug: 'gioi-thieu',
          status,
          scheduledAt,
          publishedAt: null,
        });

        if (visible) {
          await expect(
            service.findBySlug('gioi-thieu', true),
          ).resolves.toMatchObject({ slug: 'gioi-thieu' });
        } else {
          await expect(
            service.findBySlug('gioi-thieu', true),
          ).rejects.toBeInstanceOf(NotFoundException);
        }
      },
    );

    /** Route Admin không lọc gì — biên tập viên phải thấy bản nháp của mình. */
    it('GET /pages/admin/:slug thấy cả trang hẹn giờ tương lai', async () => {
      findUnique.mockResolvedValue({
        id: 'g1',
        slug: 'gioi-thieu',
        status: ContentStatus.PENDING,
        scheduledAt: FUTURE,
        publishedAt: FUTURE,
      });

      await expect(
        service.findBySlug('gioi-thieu', false),
      ).resolves.toMatchObject({ slug: 'gioi-thieu' });
    });
  });
});
