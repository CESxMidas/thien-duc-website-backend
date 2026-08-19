import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAX_SCHEDULE_HORIZON_MS,
  MIN_SCHEDULE_LEAD_MS,
} from '../common/schedule-window';
import { ProjectsService } from './projects.service';

/**
 * **Batch 9 — hai lệnh lịch đăng của dự án.**
 *
 * `PATCH /projects/:slug/schedule` và `DELETE /projects/:slug/schedule` là lệnh
 * RIÊNG, không đi qua `PATCH :slug`: sửa nội dung và uỷ quyền đăng trong tương
 * lai là hai việc khác nhau, khác cả quyền (chốt `@Roles(ADMIN, SUPER_ADMIN)` ở
 * controller — bộ test này chạy thẳng vào service nên không đi qua guard).
 *
 * Luật v1: **chỉ hẹn giờ cho lần công khai ĐẦU TIÊN.** Mọi ca từ chối bên dưới
 * đều quy về đúng một câu hỏi: bản ghi này đã từng ra công khai chưa?
 */

/** "Bây giờ" cố định cho mọi phép so ngưỡng. */
const NOW = new Date('2026-08-13T10:00:00.000Z');

/** Mốc hẹn hợp lệ — 20/08/2026 08:00 giờ Việt Nam. */
const FUTURE_ISO = '2026-08-20T08:00:00+07:00';
const FUTURE = new Date(FUTURE_ISO);

/** Mốc đã qua — dùng cho lịch đáo hạn và lịch sử xuất bản. */
const PAST = new Date('2026-08-13T09:00:00.000Z');

describe('ProjectsService — lệnh đặt / huỷ lịch đăng', () => {
  let service: ProjectsService;
  let prisma: { project: { findUnique: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(NOW);

    prisma = {
      project: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'p1' }),
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

  function given(state: {
    contentStatus: ContentStatus;
    scheduledAt?: Date | null;
    publishedAt?: Date | null;
  }) {
    prisma.project.findUnique.mockResolvedValue({
      id: 'p1',
      slug: 'du-an',
      contentStatus: state.contentStatus,
      scheduledAt: state.scheduledAt ?? null,
      publishedAt: state.publishedAt ?? null,
      items: [],
      galleryImages: [],
    });
  }

  /** `data` của lời gọi Prisma gần nhất. */
  function writtenData(): Record<string, unknown> {
    const [{ data }] = prisma.project.update.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    return data;
  }

  describe('đặt lịch — ca hợp lệ', () => {
    /** A — nháp chưa từng công khai. */
    it('nháp chưa từng công khai: ghi nguyên tử ba cột', async () => {
      given({ contentStatus: ContentStatus.DRAFT });

      await service.schedulePublication('du-an', FUTURE_ISO);

      const data = writtenData();
      expect(data.contentStatus).toBe(ContentStatus.PENDING);
      expect(data.scheduledAt).toEqual(FUTURE);
      // Bất biến: `publishedAt` ghi SẴN bằng mốc hẹn, để dự án tới hạn có mốc
      // công khai đúng ngay cả trước khi reconciler chạy.
      expect(data.publishedAt).toEqual(FUTURE);
    });

    /**
     * B — dự án EDITOR gửi duyệt, ADMIN duyệt bằng cách hẹn giờ. Quyết định
     * quản trị xảy ra BÂY GIỜ; việc công khai xảy ra tự động lúc đã hẹn.
     */
    it('chờ duyệt chưa hẹn giờ: duyệt-bằng-cách-hẹn-giờ', async () => {
      given({ contentStatus: ContentStatus.PENDING });

      await service.schedulePublication('du-an', FUTURE_ISO);

      const data = writtenData();
      expect(data.contentStatus).toBe(ContentStatus.PENDING);
      expect(data.scheduledAt).toEqual(FUTURE);
      expect(data.publishedAt).toEqual(FUTURE);
    });

    /** C — đổi lịch một lịch tương lai đang hoạt động. */
    it('đổi lịch: lịch tương lai hợp lệ nhận mốc mới', async () => {
      const original = new Date('2026-08-18T01:00:00.000Z');
      given({
        contentStatus: ContentStatus.PENDING,
        scheduledAt: original,
        publishedAt: original,
      });

      await service.schedulePublication('du-an', FUTURE_ISO);

      const data = writtenData();
      expect(data.scheduledAt).toEqual(FUTURE);
      expect(data.publishedAt).toEqual(FUTURE);
    });

    it('nhận mốc giờ Việt Nam (+07:00) đúng bằng instant tương ứng', async () => {
      given({ contentStatus: ContentStatus.DRAFT });

      await service.schedulePublication('du-an', '2026-08-20T08:00:00+07:00');

      // 08:00 +07:00 chính là 01:00Z — cùng một instant, lưu giống hệt nhau.
      expect(writtenData().scheduledAt).toEqual(
        new Date('2026-08-20T01:00:00.000Z'),
      );
    });
  });

  describe('đặt lịch — ca từ chối', () => {
    /**
     * D — dự án đang công khai. Nhánh này chỉ đọc `contentStatus` nên vẫn đúng
     * với DỮ LIỆU CŨ tạo trước migration (khi đó `published_at` còn NULL).
     */
    it('PUBLISHED → 409, không ghi gì', async () => {
      given({ contentStatus: ContentStatus.PUBLISHED, publishedAt: PAST });

      await expect(
        service.schedulePublication('du-an', FUTURE_ISO),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it('PUBLISHED thiếu publishedAt (dữ liệu cũ) vẫn → 409', async () => {
      given({ contentStatus: ContentStatus.PUBLISHED, publishedAt: null });

      await expect(
        service.schedulePublication('du-an', FUTURE_ISO),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    /** E — từng công khai thật rồi gỡ về nháp. */
    it('nháp TỪNG đăng → 409 (v1 không hẹn giờ đăng lại)', async () => {
      given({ contentStatus: ContentStatus.DRAFT, publishedAt: PAST });

      await expect(
        service.schedulePublication('du-an', FUTURE_ISO),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    /** F — lịch đã tới hạn: dự án đã hiển thị công khai rồi. */
    it('lịch đã tới hạn → 409 (không đổi lịch được nữa)', async () => {
      given({
        contentStatus: ContentStatus.PENDING,
        scheduledAt: PAST,
        publishedAt: PAST,
      });

      await expect(
        service.schedulePublication('du-an', FUTURE_ISO),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('dự án không tồn tại → 404', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(
        service.schedulePublication('khong-co', FUTURE_ISO),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('đặt lịch — cửa sổ thời gian (dùng chung với tin tức)', () => {
    it('đúng ngưỡng tối thiểu 60 giây → chấp nhận', async () => {
      given({ contentStatus: ContentStatus.DRAFT });
      const iso = new Date(NOW.getTime() + MIN_SCHEDULE_LEAD_MS).toISOString();

      await expect(
        service.schedulePublication('du-an', iso),
      ).resolves.toBeDefined();
    });

    it('dưới ngưỡng tối thiểu → 400', async () => {
      given({ contentStatus: ContentStatus.DRAFT });
      const iso = new Date(
        NOW.getTime() + MIN_SCHEDULE_LEAD_MS - 1_000,
      ).toISOString();

      await expect(
        service.schedulePublication('du-an', iso),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it('mốc ở quá khứ → 400', async () => {
      given({ contentStatus: ContentStatus.DRAFT });

      await expect(
        service.schedulePublication('du-an', PAST.toISOString()),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('đúng trần 2 năm → chấp nhận', async () => {
      given({ contentStatus: ContentStatus.DRAFT });
      const iso = new Date(
        NOW.getTime() + MAX_SCHEDULE_HORIZON_MS,
      ).toISOString();

      await expect(
        service.schedulePublication('du-an', iso),
      ).resolves.toBeDefined();
    });

    it('vượt trần 2 năm → 400 (bắt lỗi gõ nhầm năm)', async () => {
      given({ contentStatus: ContentStatus.DRAFT });
      const iso = new Date(
        NOW.getTime() + MAX_SCHEDULE_HORIZON_MS + 60_000,
      ).toISOString();

      await expect(
        service.schedulePublication('du-an', iso),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('huỷ lịch', () => {
    it('lịch tương lai hợp lệ → về nháp sạch, xoá cả hai mốc', async () => {
      given({
        contentStatus: ContentStatus.PENDING,
        scheduledAt: FUTURE,
        publishedAt: FUTURE,
      });

      await service.cancelScheduledPublication('du-an');

      const data = writtenData();
      expect(data.contentStatus).toBe(ContentStatus.DRAFT);
      expect(data.scheduledAt).toBeNull();
      // Mốc đó chưa bao giờ thành sự thật nên xoá được — dự án về nháp SẠCH,
      // tức lại hẹn giờ được lần nữa.
      expect(data.publishedAt).toBeNull();
    });

    it('không có lịch → 409', async () => {
      given({ contentStatus: ContentStatus.DRAFT });

      await expect(
        service.cancelScheduledPublication('du-an'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    /**
     * Lịch đã qua giờ nghĩa là dự án ĐANG hiển thị công khai (vị từ hiển thị đã
     * cho nó ra ngoài, dù reconciler chưa chạy). Huỷ lịch lúc này sẽ xoá mất mốc
     * công khai của một nội dung đã thật sự ra ngoài.
     */
    it('lịch đã tới hạn → 409, không xoá lịch sử', async () => {
      given({
        contentStatus: ContentStatus.PENDING,
        scheduledAt: PAST,
        publishedAt: PAST,
      });

      await expect(
        service.cancelScheduledPublication('du-an'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it('tổ hợp dị dạng (từng đăng rồi bị gán lịch) → 409', async () => {
      given({
        contentStatus: ContentStatus.PENDING,
        scheduledAt: FUTURE,
        // `publishedAt` KHÔNG trùng `scheduledAt` ⇒ đây là lịch sử thật.
        publishedAt: PAST,
      });

      await expect(
        service.cancelScheduledPublication('du-an'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it('dự án không tồn tại → 404', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(
        service.cancelScheduledPublication('khong-co'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
