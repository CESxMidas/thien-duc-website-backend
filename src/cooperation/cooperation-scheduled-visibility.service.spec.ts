import { Test } from '@nestjs/testing';
import { ContentStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  cooperationPubliclyVisibleWhere,
  isCooperationPubliclyVisible,
} from '../common/publication';
import { CooperationService } from './cooperation.service';

/**
 * **Batch 10 — hiển thị công khai của dự án hợp tác là chuyện của LÚC TRUY VẤN.**
 *
 * Đây là lớp bảo đảm tính đúng đắn, không phải reconciler. Trên Render Free
 * backend ngủ sau 15 phút không traffic, nên lượt cron lúc 08:00 có thể không
 * bao giờ chạy — nhưng request đầu tiên sau giờ hẹn vẫn phải thấy nội dung.
 *
 * Vị từ:
 * ```
 * contentStatus = PUBLISHED
 * HOẶC (contentStatus = PENDING AND scheduledAt IS NOT NULL AND scheduledAt <= now)
 * ```
 *
 * Ràng buộc `PENDING` ở nhánh hai KHÔNG phải chi tiết thừa: bỏ nó đi thì hàng
 * dị dạng `DRAFT` + lịch quá khứ lọt thẳng ra section trang chủ.
 *
 * Ghi chú phạm vi: dự án hợp tác **không có trang chi tiết công khai**. Đường
 * công khai duy nhất là `GET /cooperation` → `findAll(true)`; `GET
 * /cooperation/admin/:id` đã có `JwtAuthGuard`. Nên phần "detail" ở đây kiểm vị
 * từ trên bản ghi đã nạp (`isCooperationPubliclyVisible`), thứ sẽ là chốt sẵn
 * nếu sau này có route chi tiết.
 */

const NOW = new Date('2026-08-13T10:00:00.000Z');
const PAST = new Date('2026-08-13T09:00:00.000Z');
const FUTURE = new Date('2026-08-14T10:00:00.000Z');

/** Bảng ca dùng chung cho cả hai tầng (where của Prisma và vị từ trên bản ghi). */
const CASES: {
  label: string;
  contentStatus: ContentStatus;
  scheduledAt: Date | null;
  visible: boolean;
}[] = [
  {
    label: 'đã đăng',
    contentStatus: ContentStatus.PUBLISHED,
    scheduledAt: null,
    visible: true,
  },
  {
    label: 'hẹn giờ tương lai',
    contentStatus: ContentStatus.PENDING,
    scheduledAt: FUTURE,
    visible: false,
  },
  {
    label: 'lịch ĐÚNG giây đáo hạn',
    contentStatus: ContentStatus.PENDING,
    scheduledAt: NOW,
    visible: true,
  },
  {
    label: 'lịch đã qua, reconciler chưa chạy',
    contentStatus: ContentStatus.PENDING,
    scheduledAt: PAST,
    visible: true,
  },
  {
    label: 'chờ duyệt KHÔNG có lịch',
    contentStatus: ContentStatus.PENDING,
    scheduledAt: null,
    visible: false,
  },
  {
    label: 'DỊ DẠNG: nháp + lịch quá khứ',
    contentStatus: ContentStatus.DRAFT,
    scheduledAt: PAST,
    visible: false,
  },
  {
    label: 'nháp thường',
    contentStatus: ContentStatus.DRAFT,
    scheduledAt: null,
    visible: false,
  },
];

describe('Hiển thị công khai của dự án hợp tác', () => {
  describe('vị từ trên bản ghi đã nạp', () => {
    it.each(CASES)(
      '$label → $visible',
      ({ contentStatus, scheduledAt, visible }) => {
        expect(
          isCooperationPubliclyVisible({ contentStatus, scheduledAt }, NOW),
        ).toBe(visible);
      },
    );
  });

  describe('mảnh `where` của Prisma', () => {
    it('đúng hai nhánh, nhánh lịch BẮT BUỘC kèm PENDING', () => {
      const where = cooperationPubliclyVisibleWhere(NOW);

      expect(where.OR).toHaveLength(2);
      expect(where.OR?.[0]).toEqual({
        contentStatus: ContentStatus.PUBLISHED,
      });
      expect(where.OR?.[1]).toEqual({
        contentStatus: ContentStatus.PENDING,
        scheduledAt: { not: null, lte: NOW },
      });
    });

    /**
     * Nếu vị từ rút gọn thành `contentStatus != DRAFT` thì bản chờ duyệt chưa
     * hẹn giờ sẽ lọt ra công khai. Khoá lại bằng hình dạng, vì lỗi kiểu này
     * không lộ ra ở bất kỳ ca dữ liệu thông thường nào.
     */
    it('KHÔNG rút gọn thành `khác DRAFT`', () => {
      const where = cooperationPubliclyVisibleWhere(NOW);

      // Mỗi nhánh phải khớp `contentStatus` bằng một giá trị CỤ THỂ. Dạng phủ
      // định (`{ not: 'DRAFT' }`) là đúng thứ phải chặn — nó kéo theo cả bản chờ
      // duyệt chưa hẹn giờ. (`scheduledAt: { not: null }` thì hợp lệ và khác
      // chuyện, nên chỉ soi riêng `contentStatus`.)
      for (const branch of where.OR ?? []) {
        expect(typeof branch.contentStatus).toBe('string');
      }
      expect(where.OR?.map((branch) => branch.contentStatus)).toEqual([
        ContentStatus.PUBLISHED,
        ContentStatus.PENDING,
      ]);
    });
  });

  describe('danh sách công khai đi qua đúng vị từ đó', () => {
    let service: CooperationService;
    let findMany: jest.Mock;

    beforeEach(async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick'] });
      jest.setSystemTime(NOW);
      findMany = jest.fn().mockResolvedValue([]);

      const moduleRef = await Test.createTestingModule({
        providers: [
          CooperationService,
          {
            provide: PrismaService,
            useValue: { cooperationProject: { findMany } },
          },
        ],
      }).compile();

      service = moduleRef.get(CooperationService);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('GET /cooperation dùng vị từ hiển thị, không hardcode PUBLISHED', async () => {
      await service.findAll(true);

      const [{ where }] = findMany.mock.calls[0] as [{ where: unknown }];
      expect(where).toEqual(cooperationPubliclyVisibleWhere(NOW));
    });

    it('danh sách Admin vẫn thấy mọi trạng thái', async () => {
      await service.findAll(false);

      const [{ where }] = findMany.mock.calls[0] as [{ where?: unknown }];
      expect(where).toBeUndefined();
    });

    /** Thứ tự hiển thị không được đổi vì batch này — vẫn `order` rồi `createdAt`. */
    it('giữ nguyên thứ tự order → createdAt', async () => {
      await service.findAll(true);

      const [{ orderBy }] = findMany.mock.calls[0] as [{ orderBy: unknown }];
      expect(orderBy).toEqual([{ order: 'asc' }, { createdAt: 'asc' }]);
    });
  });
});
