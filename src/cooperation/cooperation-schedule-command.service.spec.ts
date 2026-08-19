import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentStatus, Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAX_SCHEDULE_HORIZON_MS,
  MIN_SCHEDULE_LEAD_MS,
} from '../common/schedule-window';
import { CooperationService } from './cooperation.service';

/**
 * **Batch 10 — hai lệnh lịch đăng của dự án hợp tác, và ngữ nghĩa mốc thời gian
 * của "Đăng ngay".**
 *
 * `PATCH /cooperation/:id/schedule` và `DELETE /cooperation/:id/schedule` là
 * lệnh RIÊNG, không đi qua `PATCH :id`: sửa nội dung và uỷ quyền đăng trong
 * tương lai là hai việc khác nhau, khác cả quyền (chốt `@Roles(ADMIN,
 * SUPER_ADMIN)` ở controller — bộ test này chạy thẳng vào service nên không đi
 * qua guard; xem `cooperation.controller.ts` cho chốt vai trò).
 *
 * Định danh của model này là **`id` (uuid)**, không phải slug — bảng
 * `cooperation_projects` không có cột slug.
 *
 * Luật v1: **chỉ hẹn giờ cho lần công khai ĐẦU TIÊN.** Mọi ca từ chối bên dưới
 * đều quy về đúng một câu hỏi: bản ghi này đã từng ra công khai chưa?
 */

/** "Bây giờ" cố định cho mọi phép so ngưỡng. */
const NOW = new Date('2026-08-13T10:00:00.000Z');

/** Mốc hẹn hợp lệ — 20/08/2026 08:00 giờ Việt Nam (+07:00). */
const FUTURE_ISO = '2026-08-20T08:00:00+07:00';
const FUTURE = new Date(FUTURE_ISO);

/** Mốc đã qua — dùng cho lịch đáo hạn và lịch sử xuất bản. */
const PAST = new Date('2026-08-13T09:00:00.000Z');

describe('CooperationService — lệnh đặt / huỷ lịch đăng', () => {
  let service: CooperationService;
  let prisma: {
    cooperationProject: { findUnique: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(NOW);

    prisma = {
      cooperationProject: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'c1' }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CooperationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(CooperationService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function given(state: {
    contentStatus: ContentStatus;
    scheduledAt?: Date | null;
    publishedAt?: Date | null;
  }) {
    prisma.cooperationProject.findUnique.mockResolvedValue({
      id: 'c1',
      contentStatus: state.contentStatus,
      scheduledAt: state.scheduledAt ?? null,
      publishedAt: state.publishedAt ?? null,
      // Trạng thái mô tả bằng CHỮ — phải sống sót qua mọi lệnh lịch.
      status: { vi: 'Đang triển khai' },
      order: 3,
    });
  }

  /** `data` của lời gọi `update` gần nhất. */
  function written(): Record<string, unknown> {
    const [{ data }] = prisma.cooperationProject.update.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    return data;
  }

  describe('đặt lịch — ghi nguyên tử ba cột', () => {
    /**
     * Ca A của §15: nháp chưa từng công khai. Đây là đường ADMIN tự hẹn giờ nội
     * dung của chính mình.
     */
    it('DRAFT chưa từng công khai → PENDING + scheduledAt = publishedAt = X', async () => {
      given({ contentStatus: ContentStatus.DRAFT });

      await service.schedulePublication('c1', FUTURE_ISO);

      expect(written()).toEqual({
        contentStatus: ContentStatus.PENDING,
        scheduledAt: FUTURE,
        publishedAt: FUTURE,
      });
    });

    /**
     * Ca B của §15 — và là tiêu chí nghiệm thu C: **duyệt bằng cách đặt lịch**.
     * Bản do EDITOR gửi lên đang `PENDING` chưa hẹn giờ; ADMIN hẹn giờ cho nó
     * thay vì bấm "Duyệt & đăng" ngay.
     */
    it('PENDING do EDITOR gửi lên (chưa hẹn giờ) → đặt lịch được, giữ PENDING', async () => {
      given({ contentStatus: ContentStatus.PENDING });

      await service.schedulePublication('c1', FUTURE_ISO);

      expect(written()).toEqual({
        contentStatus: ContentStatus.PENDING,
        scheduledAt: FUTURE,
        publishedAt: FUTURE,
      });
    });

    /**
     * §16: đặt lịch KHÔNG phải sửa nội dung. `status` (chữ) và `order` không
     * được nằm trong `data` — nếu lọt vào, một lệnh lịch sẽ âm thầm ghi đè nội
     * dung biên tập viên vừa sửa.
     */
    it('KHÔNG chạm `status` (chữ mô tả) hay `order`', async () => {
      given({ contentStatus: ContentStatus.DRAFT });

      await service.schedulePublication('c1', FUTURE_ISO);

      expect(written()).not.toHaveProperty('status');
      expect(written()).not.toHaveProperty('order');
    });
  });

  describe('đổi lịch (§17)', () => {
    it('lịch tương lai hợp lệ → cập nhật CẢ HAI mốc về X mới', async () => {
      const oldSchedule = new Date('2026-08-15T01:00:00.000Z');
      given({
        contentStatus: ContentStatus.PENDING,
        scheduledAt: oldSchedule,
        publishedAt: oldSchedule,
      });

      await service.schedulePublication('c1', FUTURE_ISO);

      expect(written()).toEqual({
        contentStatus: ContentStatus.PENDING,
        scheduledAt: FUTURE,
        publishedAt: FUTURE,
      });
    });
  });

  describe('từ chối đặt lịch', () => {
    /** §15-D. Nhánh này không cần `publishedAt` nên đúng cả với dữ liệu cũ. */
    it('đang PUBLISHED → 409 (kể cả khi publishedAt còn NULL — dữ liệu trước Batch 10)', async () => {
      given({ contentStatus: ContentStatus.PUBLISHED, publishedAt: null });

      await expect(
        service.schedulePublication('c1', FUTURE_ISO),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.cooperationProject.update).not.toHaveBeenCalled();
    });

    /** §15-E: từng công khai thật rồi bị gỡ về nháp. */
    it('nháp NHƯNG đã từng đăng (publishedAt quá khứ) → 409', async () => {
      given({ contentStatus: ContentStatus.DRAFT, publishedAt: PAST });

      await expect(
        service.schedulePublication('c1', FUTURE_ISO),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.cooperationProject.update).not.toHaveBeenCalled();
    });

    /**
     * §15-F: lịch đã tới hạn. Theo vị từ hiển thị, bản ghi này ĐANG công khai
     * dù reconciler chưa chạy — nên hẹn lại giờ là hẹn giờ cho thứ đã ra ngoài.
     */
    it('lịch ĐÃ tới hạn (chưa reconcile) → 409, không hẹn lại được', async () => {
      given({
        contentStatus: ContentStatus.PENDING,
        scheduledAt: PAST,
        publishedAt: PAST,
      });

      await expect(
        service.schedulePublication('c1', FUTURE_ISO),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.cooperationProject.update).not.toHaveBeenCalled();
    });
  });

  describe('cửa sổ thời gian (§14 — dùng chung với Tin tức/Dự án)', () => {
    it('mốc cách hiện tại dưới 1 phút → 400', async () => {
      given({ contentStatus: ContentStatus.DRAFT });
      const tooSoon = new Date(NOW.getTime() + MIN_SCHEDULE_LEAD_MS - 1000);

      await expect(
        service.schedulePublication('c1', tooSoon.toISOString()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.cooperationProject.update).not.toHaveBeenCalled();
    });

    it('mốc quá 2 năm → 400', async () => {
      given({ contentStatus: ContentStatus.DRAFT });
      const tooFar = new Date(NOW.getTime() + MAX_SCHEDULE_HORIZON_MS + 60_000);

      await expect(
        service.schedulePublication('c1', tooFar.toISOString()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.cooperationProject.update).not.toHaveBeenCalled();
    });

    /**
     * Giờ Việt Nam phải ra đúng instant. `+07:00` là dạng Admin CMS gửi lên
     * (xem `SchedulePublishDialog`), nên đây là ca thật, không phải ca biên.
     */
    it('chuỗi +07:00 quy về đúng instant UTC', async () => {
      given({ contentStatus: ContentStatus.DRAFT });

      await service.schedulePublication('c1', '2026-08-20T08:00:00+07:00');

      expect(written().scheduledAt).toEqual(
        new Date('2026-08-20T01:00:00.000Z'),
      );
    });
  });

  describe('huỷ lịch', () => {
    /** §18: về nháp sạch, thu hồi luôn phê duyệt. */
    it('lịch tương lai hợp lệ → DRAFT + xoá cả hai mốc', async () => {
      given({
        contentStatus: ContentStatus.PENDING,
        scheduledAt: FUTURE,
        publishedAt: FUTURE,
      });

      await service.cancelScheduledPublication('c1');

      expect(written()).toEqual({
        contentStatus: ContentStatus.DRAFT,
        scheduledAt: null,
        publishedAt: null,
      });
    });

    /**
     * §19: lịch đã tới hạn = nội dung đang công khai. Huỷ ở đây sẽ xoá
     * `publishedAt` — tức xoá mất mốc công khai THẬT. Phải từ chối và chỉ sang
     * "Trả về nháp".
     */
    it('lịch ĐÃ tới hạn → 409, không xoá lịch sử', async () => {
      given({
        contentStatus: ContentStatus.PENDING,
        scheduledAt: PAST,
        publishedAt: PAST,
      });

      await expect(
        service.cancelScheduledPublication('c1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.cooperationProject.update).not.toHaveBeenCalled();
    });

    it('không có lịch nào → 409', async () => {
      given({ contentStatus: ContentStatus.DRAFT });

      await expect(
        service.cancelScheduledPublication('c1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.cooperationProject.update).not.toHaveBeenCalled();
    });

    /**
     * Tổ hợp dị dạng: lịch ở tương lai nhưng `publishedAt` là lịch sử thật
     * (không khớp `scheduledAt`). Nhánh xoá sẽ xoá mất lịch sử đó → từ chối.
     */
    it('lịch tương lai nhưng publishedAt là lịch sử thật → 409', async () => {
      given({
        contentStatus: ContentStatus.PENDING,
        scheduledAt: FUTURE,
        publishedAt: PAST,
      });

      await expect(
        service.cancelScheduledPublication('c1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.cooperationProject.update).not.toHaveBeenCalled();
    });
  });

  /**
   * §20 + §21 — "Đăng ngay" và "Trả về nháp" đi qua `updateStatus`, cùng ngữ
   * nghĩa `publishedAt` với Dự án.
   */
  describe('Đăng ngay / Trả về nháp — ngữ nghĩa mốc công khai', () => {
    it('DRAFT chưa từng công khai → PUBLISHED, publishedAt = now, scheduledAt = null', async () => {
      given({ contentStatus: ContentStatus.DRAFT });

      await service.updateStatus('c1', ContentStatus.PUBLISHED, Role.ADMIN);

      expect(written()).toEqual({
        contentStatus: ContentStatus.PUBLISHED,
        publishedAt: NOW,
        scheduledAt: null,
      });
    });

    it('PENDING chưa hẹn giờ → PUBLISHED, publishedAt = now', async () => {
      given({ contentStatus: ContentStatus.PENDING });

      await service.updateStatus('c1', ContentStatus.PUBLISHED, Role.ADMIN);

      expect(written().publishedAt).toEqual(NOW);
    });

    /**
     * Ca tinh tế nhất. Lệnh đặt lịch đã ghi `publishedAt = scheduledAt` ở TƯƠNG
     * LAI. Giữ nguyên mốc đó thì bản vừa bấm đăng lại mang mốc công khai nằm ở
     * ngày mai — sai với chính nghĩa của nút "Đăng ngay".
     */
    it('đang hẹn lịch tương lai → PUBLISHED, publishedAt = NOW thật (không phải mốc đã hẹn)', async () => {
      given({
        contentStatus: ContentStatus.PENDING,
        scheduledAt: FUTURE,
        publishedAt: FUTURE,
      });

      await service.updateStatus('c1', ContentStatus.PUBLISHED, Role.ADMIN);

      expect(written()).toEqual({
        contentStatus: ContentStatus.PUBLISHED,
        publishedAt: NOW,
        scheduledAt: null,
      });
    });

    it('đăng lại bản từng công khai → giữ nguyên mốc gốc', async () => {
      given({ contentStatus: ContentStatus.DRAFT, publishedAt: PAST });

      await service.updateStatus('c1', ContentStatus.PUBLISHED, Role.ADMIN);

      expect(written().publishedAt).toEqual(PAST);
    });

    /** §21: gỡ một bản đã công khai THẬT không được xoá lịch sử. */
    it('PUBLISHED (có lịch sử) → DRAFT giữ nguyên publishedAt, xoá lịch', async () => {
      given({ contentStatus: ContentStatus.PUBLISHED, publishedAt: PAST });

      await service.updateStatus('c1', ContentStatus.DRAFT, Role.ADMIN);

      expect(written()).toEqual({
        contentStatus: ContentStatus.DRAFT,
        publishedAt: PAST,
        scheduledAt: null,
      });
    });

    it('PENDING chưa từng công khai → DRAFT, publishedAt vẫn NULL', async () => {
      given({ contentStatus: ContentStatus.PENDING });

      await service.updateStatus('c1', ContentStatus.DRAFT, Role.ADMIN);

      expect(written().publishedAt).toBeNull();
    });

    /** Đổi trạng thái KHÔNG phải sửa nội dung: `status` (chữ) không được đụng. */
    it('không chạm `status` mô tả bằng chữ', async () => {
      given({ contentStatus: ContentStatus.DRAFT });

      await service.updateStatus('c1', ContentStatus.PUBLISHED, Role.ADMIN);

      expect(written()).not.toHaveProperty('status');
    });
  });
});
