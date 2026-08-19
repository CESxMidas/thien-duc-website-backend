import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentStatus, Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CooperationService } from './cooperation.service';

/**
 * **Batch 10 siết lại luật sửa của Batch 8 trên dự án hợp tác.**
 *
 * Trước Batch 10, dự án hợp tác chưa có cột mốc thời gian nên luật đành lấy
 * phần chắc chắn: chặn ở `PUBLISHED`, cho sửa mọi `PENDING`. Nay nó hẹn giờ
 * được, và "mọi PENDING" không còn đủ — một bản ĐÃ ĐƯỢC ADMIN LÊN LỊCH vẫn lưu
 * là `PENDING`. Để nguyên luật cũ là mở lại đúng lỗ hổng 07:59 mà Batch 8 đã
 * đóng, lần này trên dự án hợp tác:
 *
 * ```
 * 07:00  ADMIN hẹn đăng lúc 08:00        (PENDING + scheduledAt)
 * 07:59  EDITOR sửa nội dung
 * 08:00  bản ĐÃ SỬA tự ra trang chủ
 * ```
 *
 * Luật mới khớp từng ca với Tin tức và Dự án: cho sửa nháp chưa từng công khai
 * và bản chờ duyệt CHƯA hẹn giờ; chặn lịch tương lai, lịch đã tới hạn, bản đang
 * đăng, và nháp từng đăng.
 *
 * ADMIN/SUPER_ADMIN KHÔNG đổi — luồng đính chính của quản trị vẫn sửa được ở
 * mọi trạng thái.
 */

const NOW = new Date('2026-08-13T10:00:00.000Z');
const PAST = new Date('2026-08-13T09:00:00.000Z');
const FUTURE = new Date('2026-08-14T10:00:00.000Z');

const bilingual = (vi: string) => ({ vi, en: vi });

/** Bảng ca: trạng thái lưu trữ × EDITOR có được sửa không. */
const STATES: {
  label: string;
  contentStatus: ContentStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  editorMayEdit: boolean;
}[] = [
  {
    label: 'nháp chưa từng công khai',
    contentStatus: ContentStatus.DRAFT,
    scheduledAt: null,
    publishedAt: null,
    editorMayEdit: true,
  },
  {
    label: 'chờ duyệt CHƯA hẹn giờ',
    contentStatus: ContentStatus.PENDING,
    scheduledAt: null,
    publishedAt: null,
    editorMayEdit: true,
  },
  {
    label: 'đã lên lịch (tương lai)',
    contentStatus: ContentStatus.PENDING,
    scheduledAt: FUTURE,
    publishedAt: FUTURE,
    editorMayEdit: false,
  },
  {
    label: 'lịch đã tới hạn (đang công khai, chưa reconcile)',
    contentStatus: ContentStatus.PENDING,
    scheduledAt: PAST,
    publishedAt: PAST,
    editorMayEdit: false,
  },
  {
    label: 'đang đăng',
    contentStatus: ContentStatus.PUBLISHED,
    scheduledAt: null,
    publishedAt: PAST,
    editorMayEdit: false,
  },
  {
    label: 'nháp NHƯNG từng đăng (lịch sử thật)',
    contentStatus: ContentStatus.DRAFT,
    scheduledAt: null,
    publishedAt: PAST,
    editorMayEdit: false,
  },
];

describe('CooperationService — quyền sửa nội dung sau khi có lịch đăng', () => {
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

  function given(state: (typeof STATES)[number]) {
    prisma.cooperationProject.findUnique.mockResolvedValue({
      id: 'c1',
      contentStatus: state.contentStatus,
      scheduledAt: state.scheduledAt,
      publishedAt: state.publishedAt,
    });
  }

  describe('EDITOR', () => {
    it.each(STATES.filter((state) => state.editorMayEdit))(
      'sửa được: $label',
      async (state) => {
        given(state);

        await service.update('c1', { name: bilingual('Tên mới') }, Role.EDITOR);

        expect(prisma.cooperationProject.update).toHaveBeenCalled();
      },
    );

    it.each(STATES.filter((state) => !state.editorMayEdit))(
      'KHÔNG sửa được: $label → 403, không ghi gì',
      async (state) => {
        given(state);

        await expect(
          service.update('c1', { name: bilingual('Tên mới') }, Role.EDITOR),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.cooperationProject.update).not.toHaveBeenCalled();
      },
    );

    /**
     * §36 — chốt này KHÔNG được vơ đũa cả nắm. `status` (chữ mô tả song ngữ,
     * vd. "Đã bàn giao") là nội dung biên tập bình thường. Ở trạng thái được
     * phép, EDITOR phải sửa được nó như mọi field khác; nhầm nó với
     * `contentStatus` là vừa chặn mất việc chính đáng vừa gieo nhầm lẫn.
     */
    it.each(STATES.filter((state) => state.editorMayEdit))(
      'vẫn sửa được `status` (chữ mô tả) khi ở trạng thái cho phép: $label',
      async (state) => {
        given(state);

        await service.update(
          'c1',
          { status: bilingual('Đã bàn giao') },
          Role.EDITOR,
        );

        const [{ data }] = prisma.cooperationProject.update.mock.calls[0] as [
          { data: Record<string, unknown> },
        ];
        expect(data.status).toEqual(bilingual('Đã bàn giao'));
        // …mà không kéo theo bất kỳ cột xuất bản nào.
        expect(data.contentStatus).toBeUndefined();
        expect(data.publishedAt).toBeUndefined();
        expect(data.scheduledAt).toBeUndefined();
      },
    );
  });

  describe('ADMIN / SUPER_ADMIN — không hồi quy', () => {
    it.each(
      STATES.flatMap((state) =>
        [Role.ADMIN, Role.SUPER_ADMIN].map(
          (role) => [role, state] as [Role, (typeof STATES)[number]],
        ),
      ),
    )('%s sửa được ở mọi trạng thái: $label', async (role, state) => {
      given(state);

      await service.update('c1', { name: bilingual('Tên mới') }, role);

      expect(prisma.cooperationProject.update).toHaveBeenCalled();
    });
  });

  describe('fail closed', () => {
    it('thiếu vai trò → 403 kể cả trên bản nháp sạch', async () => {
      given(STATES[0]);

      await expect(
        service.update('c1', { name: bilingual('Tên mới') }, undefined),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.cooperationProject.update).not.toHaveBeenCalled();
    });
  });
});
