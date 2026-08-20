import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentStatus, Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAX_SCHEDULE_HORIZON_MS,
  MIN_SCHEDULE_LEAD_MS,
} from '../common/schedule-window';
import { PagesService } from './pages.service';

/**
 * **Batch 11 — hai lệnh lịch đăng của trang nội dung, và ngữ nghĩa mốc thời
 * gian của "Đăng ngay".**
 *
 * `PATCH /pages/:slug/schedule` và `DELETE /pages/:slug/schedule` là lệnh RIÊNG,
 * không đi qua `PATCH :slug`: sửa nội dung và uỷ quyền đăng trong tương lai là
 * hai việc khác nhau, khác cả quyền (chốt `@Roles(ADMIN, SUPER_ADMIN)` ở
 * controller — bộ test này chạy thẳng vào service nên không đi qua guard).
 *
 * Cột trạng thái của model này là **`status`** (giống `NewsPost`), không phải
 * `contentStatus`.
 *
 * Luật v1: **chỉ hẹn giờ cho lần công khai ĐẦU TIÊN.** Mọi ca từ chối bên dưới
 * đều quy về đúng một câu hỏi: trang này đã từng ra công khai chưa?
 */

/** "Bây giờ" cố định cho mọi phép so ngưỡng. */
const NOW = new Date('2026-08-13T10:00:00.000Z');

/** Mốc hẹn hợp lệ — 20/08/2026 08:00 giờ Việt Nam (+07:00). */
const FUTURE_ISO = '2026-08-20T08:00:00+07:00';
const FUTURE = new Date(FUTURE_ISO);

/** Mốc đã qua — dùng cho lịch đáo hạn và lịch sử xuất bản. */
const PAST = new Date('2026-08-13T09:00:00.000Z');

describe('PagesService — lệnh đặt / huỷ lịch đăng', () => {
  let service: PagesService;
  let prisma: { page: { findUnique: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(NOW);

    prisma = {
      page: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'g1' }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [PagesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(PagesService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function given(state: {
    status: ContentStatus;
    scheduledAt?: Date | null;
    publishedAt?: Date | null;
  }) {
    prisma.page.findUnique.mockResolvedValue({
      id: 'g1',
      slug: 'gioi-thieu',
      status: state.status,
      scheduledAt: state.scheduledAt ?? null,
      publishedAt: state.publishedAt ?? null,
      title: { vi: 'Giới thiệu' },
      content: [{ vi: 'Nội dung.' }],
    });
  }

  /** `data` của lời gọi `update` gần nhất. */
  function written(): Record<string, unknown> {
    const [{ data }] = prisma.page.update.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    return data;
  }

  describe('đặt lịch — ghi nguyên tử ba cột', () => {
    /** Ca A của §14: nháp chưa từng công khai. */
    it('DRAFT chưa từng công khai → PENDING + scheduledAt = publishedAt = X', async () => {
      given({ status: ContentStatus.DRAFT });

      await service.schedulePublication('gioi-thieu', FUTURE_ISO);

      expect(written()).toEqual({
        status: ContentStatus.PENDING,
        scheduledAt: FUTURE,
        publishedAt: FUTURE,
      });
    });

    /**
     * Ca B của §14 — và là tiêu chí nghiệm thu C: **duyệt bằng cách đặt lịch**.
     * Trang do EDITOR gửi lên đang `PENDING` chưa hẹn giờ.
     */
    it('PENDING do EDITOR gửi lên (chưa hẹn giờ) → đặt lịch được, giữ PENDING', async () => {
      given({ status: ContentStatus.PENDING });

      await service.schedulePublication('gioi-thieu', FUTURE_ISO);

      expect(written()).toEqual({
        status: ContentStatus.PENDING,
        scheduledAt: FUTURE,
        publishedAt: FUTURE,
      });
    });

    /** §15: đặt lịch KHÔNG phải sửa nội dung. */
    it('KHÔNG chạm slug/title/content', async () => {
      given({ status: ContentStatus.DRAFT });

      await service.schedulePublication('gioi-thieu', FUTURE_ISO);

      expect(written()).not.toHaveProperty('slug');
      expect(written()).not.toHaveProperty('title');
      expect(written()).not.toHaveProperty('content');
    });
  });

  describe('đổi lịch (§16)', () => {
    it('lịch tương lai hợp lệ → cập nhật CẢ HAI mốc về X mới', async () => {
      const oldSchedule = new Date('2026-08-15T01:00:00.000Z');
      given({
        status: ContentStatus.PENDING,
        scheduledAt: oldSchedule,
        publishedAt: oldSchedule,
      });

      await service.schedulePublication('gioi-thieu', FUTURE_ISO);

      expect(written()).toEqual({
        status: ContentStatus.PENDING,
        scheduledAt: FUTURE,
        publishedAt: FUTURE,
      });
    });
  });

  describe('từ chối đặt lịch', () => {
    /** §14-D. Nhánh này không cần `publishedAt` nên đúng cả với dữ liệu cũ. */
    it('đang PUBLISHED → 409 (kể cả khi publishedAt còn NULL — dữ liệu trước Batch 11)', async () => {
      given({ status: ContentStatus.PUBLISHED, publishedAt: null });

      await expect(
        service.schedulePublication('gioi-thieu', FUTURE_ISO),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.page.update).not.toHaveBeenCalled();
    });

    /** §14-E: từng công khai thật rồi bị gỡ về nháp. */
    it('nháp NHƯNG đã từng đăng (publishedAt quá khứ) → 409', async () => {
      given({ status: ContentStatus.DRAFT, publishedAt: PAST });

      await expect(
        service.schedulePublication('gioi-thieu', FUTURE_ISO),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.page.update).not.toHaveBeenCalled();
    });

    /** §14-F: lịch đã tới hạn — trang ĐANG công khai theo vị từ hiển thị. */
    it('lịch ĐÃ tới hạn (chưa reconcile) → 409, không hẹn lại được', async () => {
      given({
        status: ContentStatus.PENDING,
        scheduledAt: PAST,
        publishedAt: PAST,
      });

      await expect(
        service.schedulePublication('gioi-thieu', FUTURE_ISO),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.page.update).not.toHaveBeenCalled();
    });
  });

  describe('cửa sổ thời gian (§13 — dùng chung với các module khác)', () => {
    it('mốc cách hiện tại dưới 1 phút → 400', async () => {
      given({ status: ContentStatus.DRAFT });
      const tooSoon = new Date(NOW.getTime() + MIN_SCHEDULE_LEAD_MS - 1000);

      await expect(
        service.schedulePublication('gioi-thieu', tooSoon.toISOString()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.page.update).not.toHaveBeenCalled();
    });

    it('mốc quá 2 năm → 400', async () => {
      given({ status: ContentStatus.DRAFT });
      const tooFar = new Date(NOW.getTime() + MAX_SCHEDULE_HORIZON_MS + 60_000);

      await expect(
        service.schedulePublication('gioi-thieu', tooFar.toISOString()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.page.update).not.toHaveBeenCalled();
    });

    it('chuỗi +07:00 quy về đúng instant UTC', async () => {
      given({ status: ContentStatus.DRAFT });

      await service.schedulePublication(
        'gioi-thieu',
        '2026-08-20T08:00:00+07:00',
      );

      expect(written().scheduledAt).toEqual(
        new Date('2026-08-20T01:00:00.000Z'),
      );
    });
  });

  describe('huỷ lịch', () => {
    /** §17: về nháp sạch, thu hồi luôn phê duyệt. */
    it('lịch tương lai hợp lệ → DRAFT + xoá cả hai mốc', async () => {
      given({
        status: ContentStatus.PENDING,
        scheduledAt: FUTURE,
        publishedAt: FUTURE,
      });

      await service.cancelScheduledPublication('gioi-thieu');

      expect(written()).toEqual({
        status: ContentStatus.DRAFT,
        scheduledAt: null,
        publishedAt: null,
      });
    });

    /** §18: lịch đã tới hạn = nội dung đang công khai. */
    it('lịch ĐÃ tới hạn → 409, không xoá lịch sử', async () => {
      given({
        status: ContentStatus.PENDING,
        scheduledAt: PAST,
        publishedAt: PAST,
      });

      await expect(
        service.cancelScheduledPublication('gioi-thieu'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.page.update).not.toHaveBeenCalled();
    });

    it('không có lịch nào → 409', async () => {
      given({ status: ContentStatus.DRAFT });

      await expect(
        service.cancelScheduledPublication('gioi-thieu'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.page.update).not.toHaveBeenCalled();
    });

    it('lịch tương lai nhưng publishedAt là lịch sử thật → 409', async () => {
      given({
        status: ContentStatus.PENDING,
        scheduledAt: FUTURE,
        publishedAt: PAST,
      });

      await expect(
        service.cancelScheduledPublication('gioi-thieu'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.page.update).not.toHaveBeenCalled();
    });
  });

  /** §19 + §20 — "Đăng ngay" và "Trả về nháp" đi qua `updateStatus`. */
  describe('Đăng ngay / Trả về nháp — ngữ nghĩa mốc công khai', () => {
    it('DRAFT chưa từng công khai → PUBLISHED, publishedAt = now, scheduledAt = null', async () => {
      given({ status: ContentStatus.DRAFT });

      await service.updateStatus(
        'gioi-thieu',
        ContentStatus.PUBLISHED,
        Role.ADMIN,
      );

      expect(written()).toEqual({
        status: ContentStatus.PUBLISHED,
        publishedAt: NOW,
        scheduledAt: null,
      });
    });

    it('PENDING chưa hẹn giờ → PUBLISHED, publishedAt = now', async () => {
      given({ status: ContentStatus.PENDING });

      await service.updateStatus(
        'gioi-thieu',
        ContentStatus.PUBLISHED,
        Role.ADMIN,
      );

      expect(written().publishedAt).toEqual(NOW);
    });

    /**
     * Ca tinh tế nhất. Lệnh đặt lịch đã ghi `publishedAt = scheduledAt` ở TƯƠNG
     * LAI. Giữ nguyên mốc đó thì trang vừa bấm đăng lại mang mốc công khai nằm ở
     * ngày mai — sai với chính nghĩa của nút "Đăng ngay".
     */
    it('đang hẹn lịch tương lai → PUBLISHED, publishedAt = NOW thật (không phải mốc đã hẹn)', async () => {
      given({
        status: ContentStatus.PENDING,
        scheduledAt: FUTURE,
        publishedAt: FUTURE,
      });

      await service.updateStatus(
        'gioi-thieu',
        ContentStatus.PUBLISHED,
        Role.ADMIN,
      );

      expect(written()).toEqual({
        status: ContentStatus.PUBLISHED,
        publishedAt: NOW,
        scheduledAt: null,
      });
    });

    it('đăng lại trang từng công khai → giữ nguyên mốc gốc', async () => {
      given({ status: ContentStatus.DRAFT, publishedAt: PAST });

      await service.updateStatus(
        'gioi-thieu',
        ContentStatus.PUBLISHED,
        Role.ADMIN,
      );

      expect(written().publishedAt).toEqual(PAST);
    });

    /** §20: gỡ một trang đã công khai THẬT không được xoá lịch sử. */
    it('PUBLISHED (có lịch sử) → DRAFT giữ nguyên publishedAt, xoá lịch', async () => {
      given({ status: ContentStatus.PUBLISHED, publishedAt: PAST });

      await service.updateStatus('gioi-thieu', ContentStatus.DRAFT, Role.ADMIN);

      expect(written()).toEqual({
        status: ContentStatus.DRAFT,
        publishedAt: PAST,
        scheduledAt: null,
      });
    });

    it('PENDING chưa từng công khai → DRAFT, publishedAt vẫn NULL', async () => {
      given({ status: ContentStatus.PENDING });

      await service.updateStatus('gioi-thieu', ContentStatus.DRAFT, Role.ADMIN);

      expect(written().publishedAt).toBeNull();
    });

    it('không chạm nội dung trang', async () => {
      given({ status: ContentStatus.DRAFT });

      await service.updateStatus(
        'gioi-thieu',
        ContentStatus.PUBLISHED,
        Role.ADMIN,
      );

      expect(written()).not.toHaveProperty('title');
      expect(written()).not.toHaveProperty('content');
    });
  });
});
