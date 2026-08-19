import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentStatus, Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from './projects.service';

/**
 * **Batch 9 — hai thứ mà việc thêm cột mốc thời gian bắt buộc phải siết lại.**
 *
 * 1. **Quyền sửa của EDITOR.** Batch 8 chốt "chặn ở PUBLISHED, cho sửa mọi
 *    PENDING" vì dự án khi đó không có cột nào để phân biệt hơn. Nay một dự án
 *    ĐÃ ĐƯỢC ADMIN LÊN LỊCH vẫn lưu là `PENDING`, nên luật cũ mở lại đúng lỗ
 *    hổng 07:59 — lần này trên dự án:
 *
 *    ```
 *    07:00  ADMIN hẹn đăng dự án lúc 08:00
 *    07:59  EDITOR sửa nội dung
 *    08:00  bản ĐÃ SỬA tự ra công khai
 *    ```
 *
 * 2. **Mốc `publishedAt` khi đổi trạng thái thủ công.** Nó phải luôn có nghĩa
 *    *lần công khai ĐẦU TIÊN* — không bị ghi đè bởi lần đăng lại, và không mang
 *    một mốc tương lai chưa từng xảy ra.
 */

const NOW = new Date('2026-08-13T10:00:00.000Z');
const FUTURE = new Date('2026-08-20T01:00:00.000Z');
const PAST = new Date('2026-08-01T01:00:00.000Z');

const states = {
  /** A — nháp chưa từng công khai. */
  draft: {
    contentStatus: ContentStatus.DRAFT,
    scheduledAt: null,
    publishedAt: null,
  },
  /** B — chờ duyệt, chưa hẹn giờ. */
  pendingUnscheduled: {
    contentStatus: ContentStatus.PENDING,
    scheduledAt: null,
    publishedAt: null,
  },
  /** C — đã lên lịch, chưa tới hạn. */
  scheduled: {
    contentStatus: ContentStatus.PENDING,
    scheduledAt: FUTURE,
    publishedAt: FUTURE,
  },
  /** D — lịch đã tới hạn, reconciler chưa chạy. */
  due: {
    contentStatus: ContentStatus.PENDING,
    scheduledAt: PAST,
    publishedAt: PAST,
  },
  /** E — đang đăng công khai. */
  published: {
    contentStatus: ContentStatus.PUBLISHED,
    scheduledAt: null,
    publishedAt: PAST,
  },
  /** F — từng đăng rồi bị gỡ về nháp; `publishedAt` là lịch sử thật. */
  historicalDraft: {
    contentStatus: ContentStatus.DRAFT,
    scheduledAt: null,
    publishedAt: PAST,
  },
} as const;

type StateKey = keyof typeof states;
const ALL_STATES = Object.keys(states) as StateKey[];

describe('ProjectsService — quyền sửa của EDITOR sau khi có lịch đăng', () => {
  let service: ProjectsService;
  let prisma: {
    project: { findUnique: jest.Mock; update: jest.Mock };
    projectItem: { findFirst: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(NOW);

    prisma = {
      project: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'p1' }),
      },
      projectItem: {
        findFirst: jest.fn().mockResolvedValue({ id: 'item-1' }),
        update: jest.fn().mockResolvedValue({ id: 'item-1' }),
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

  function given(state: StateKey) {
    prisma.project.findUnique.mockResolvedValue({
      id: 'p1',
      slug: 'du-an',
      ...states[state],
      items: [],
      galleryImages: [],
    });
  }

  function writtenData(): Record<string, unknown> {
    const [{ data }] = prisma.project.update.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    return data;
  }

  const edit = { title: { vi: 'Tên đã sửa' } };

  describe('EDITOR — cho phép', () => {
    it('nháp chưa từng công khai → sửa được', async () => {
      given('draft');

      await service.update('du-an', edit, Role.EDITOR);

      expect(prisma.project.update).toHaveBeenCalledTimes(1);
    });

    /** §10 — cố ý KHÔNG siết PENDING chưa hẹn giờ. Chưa ai duyệt gì để phá vỡ. */
    it('chờ duyệt CHƯA hẹn giờ → sửa được', async () => {
      given('pendingUnscheduled');

      await service.update('du-an', edit, Role.EDITOR);

      expect(prisma.project.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('EDITOR — chặn (phần siết mới của Batch 9)', () => {
    it.each<StateKey>(['scheduled', 'due', 'published', 'historicalDraft'])(
      '%s → 403, không ghi gì',
      async (state) => {
        given(state);

        await expect(
          service.update('du-an', edit, Role.EDITOR),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.project.update).not.toHaveBeenCalled();
      },
    );

    it('thông điệp 403 nói rõ cả "đã lên lịch"', async () => {
      given('scheduled');

      await expect(service.update('du-an', edit, Role.EDITOR)).rejects.toThrow(
        /đã xuất bản hoặc đã được lên lịch/,
      );
    });

    /** Nội dung con thừa hưởng đúng vị từ của cha — không có đường vòng. */
    it.each<StateKey>(['scheduled', 'due', 'published', 'historicalDraft'])(
      '%s: hạng mục cũng bị chặn',
      async (state) => {
        given(state);

        await expect(
          service.updateItem('du-an', 'hang-muc', {}, Role.EDITOR),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.projectItem.update).not.toHaveBeenCalled();
      },
    );
  });

  describe('ADMIN / SUPER_ADMIN giữ nguyên quyền sửa', () => {
    it.each(
      ALL_STATES.flatMap((state) =>
        [Role.ADMIN, Role.SUPER_ADMIN].map(
          (role) => [`${state} (${role})`, state, role] as const,
        ),
      ),
    )('%s → sửa được', async (_label, state, role) => {
      given(state);

      await service.update('du-an', edit, role);

      expect(prisma.project.update).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * §17 — "Đăng ngay" phải ghi mốc công khai ĐÚNG với sự thật, ở cả ba ngữ cảnh.
   */
  describe('Đăng ngay — mốc publishedAt', () => {
    it('nháp chưa từng công khai → publishedAt = bây giờ', async () => {
      given('draft');

      await service.updateStatus('du-an', ContentStatus.PUBLISHED, Role.ADMIN);

      const data = writtenData();
      expect(data.publishedAt).toEqual(NOW);
      expect(data.scheduledAt).toBeNull();
    });

    it('chờ duyệt chưa hẹn giờ → publishedAt = bây giờ', async () => {
      given('pendingUnscheduled');

      await service.updateStatus('du-an', ContentStatus.PUBLISHED, Role.ADMIN);

      expect(writtenData().publishedAt).toEqual(NOW);
    });

    /**
     * Ca quan trọng nhất: lịch tương lai đã ghi `publishedAt` ở ngày mai. Bấm
     * "Đăng ngay" nghĩa là công khai **bây giờ** — lần công khai theo lịch kia
     * đã không xảy ra, nên mốc phải là hiện tại, và lịch phải bị xoá.
     */
    it('lịch tương lai + Đăng ngay → mốc về hiện tại, xoá lịch', async () => {
      given('scheduled');

      await service.updateStatus('du-an', ContentStatus.PUBLISHED, Role.ADMIN);

      const data = writtenData();
      expect(data.publishedAt).toEqual(NOW);
      expect(data.publishedAt).not.toEqual(FUTURE);
      expect(data.scheduledAt).toBeNull();
    });

    it('đăng lại dự án TỪNG công khai → giữ nguyên mốc lịch sử', async () => {
      given('historicalDraft');

      await service.updateStatus('du-an', ContentStatus.PUBLISHED, Role.ADMIN);

      expect(writtenData().publishedAt).toEqual(PAST);
    });
  });

  /** §18 — trả về nháp không được xoá lịch sử xuất bản THẬT. */
  describe('Trả về nháp — mốc publishedAt', () => {
    it('chờ duyệt chưa từng công khai → mốc vẫn NULL, xoá lịch', async () => {
      given('pendingUnscheduled');

      await service.updateStatus('du-an', ContentStatus.DRAFT, Role.ADMIN);

      const data = writtenData();
      expect(data.publishedAt).toBeNull();
      expect(data.scheduledAt).toBeNull();
    });

    it('dự án ĐANG đăng → giữ mốc lịch sử, xoá lịch treo', async () => {
      given('published');

      await service.updateStatus('du-an', ContentStatus.DRAFT, Role.ADMIN);

      const data = writtenData();
      expect(data.publishedAt).toEqual(PAST);
      expect(data.scheduledAt).toBeNull();
    });

    it('lịch đã tới hạn (đã công khai) → giữ mốc, xoá lịch', async () => {
      given('due');

      await service.updateStatus('du-an', ContentStatus.DRAFT, Role.ADMIN);

      const data = writtenData();
      expect(data.publishedAt).toEqual(PAST);
      expect(data.scheduledAt).toBeNull();
    });

    /**
     * Lịch TƯƠNG LAI bị đưa về nháp qua lệnh trạng thái chung: mốc kia chưa bao
     * giờ thành sự thật nên phải xoá, nếu không dự án sẽ mãi mãi bị coi là "đã
     * từng đăng" và không hẹn giờ lại được. (Đường chính thức vẫn là
     * `DELETE :slug/schedule`; đây là lưới an toàn cho lệnh chung.)
     */
    it('lịch tương lai → xoá cả mốc chưa thành sự thật', async () => {
      given('scheduled');

      await service.updateStatus('du-an', ContentStatus.DRAFT, Role.ADMIN);

      const data = writtenData();
      expect(data.publishedAt).toBeNull();
      expect(data.scheduledAt).toBeNull();
    });
  });

  /** §14 — gửi duyệt không đụng tới mốc công khai, cũng không huỷ lịch ngầm. */
  describe('Gửi duyệt (PENDING) — không chạm mốc công khai', () => {
    it('EDITOR gửi duyệt bản nháp: mốc giữ nguyên NULL', async () => {
      given('draft');

      await service.updateStatus('du-an', ContentStatus.PENDING, Role.EDITOR);

      const data = writtenData();
      expect(data.publishedAt).toBeNull();
      // `undefined` = Prisma không đụng tới cột lịch.
      expect(data.scheduledAt).toBeUndefined();
    });
  });
});
