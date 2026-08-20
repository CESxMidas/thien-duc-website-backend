import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentStatus, Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PagesService } from './pages.service';

/**
 * **Batch 11 siết lại luật sửa của Batch 8 trên trang nội dung.**
 *
 * Trước Batch 11, trang chưa có cột mốc thời gian nên luật đành lấy phần chắc
 * chắn: chặn ở `PUBLISHED`, cho sửa mọi `PENDING`. Nay trang hẹn giờ được, và
 * "mọi PENDING" không còn đủ — một trang ĐÃ ĐƯỢC ADMIN LÊN LỊCH vẫn lưu là
 * `PENDING`. Để nguyên luật cũ là mở lại đúng lỗ hổng 07:59 mà Batch 8 đã đóng:
 *
 * ```
 * 07:00  ADMIN hẹn đăng trang lúc 08:00   (PENDING + scheduledAt)
 * 07:59  EDITOR sửa nội dung
 * 08:00  bản ĐÃ SỬA tự ra công khai
 * ```
 *
 * §35: backend là NƠI CHỐT — bộ test này gọi thẳng service, không đi qua UI.
 */

const NOW = new Date('2026-08-13T10:00:00.000Z');
const PAST = new Date('2026-08-13T09:00:00.000Z');
const FUTURE = new Date('2026-08-14T10:00:00.000Z');

const STATES: {
  label: string;
  status: ContentStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  editorMayEdit: boolean;
}[] = [
  {
    label: 'nháp chưa từng công khai',
    status: ContentStatus.DRAFT,
    scheduledAt: null,
    publishedAt: null,
    editorMayEdit: true,
  },
  {
    label: 'chờ duyệt CHƯA hẹn giờ',
    status: ContentStatus.PENDING,
    scheduledAt: null,
    publishedAt: null,
    editorMayEdit: true,
  },
  {
    label: 'đã lên lịch (tương lai)',
    status: ContentStatus.PENDING,
    scheduledAt: FUTURE,
    publishedAt: FUTURE,
    editorMayEdit: false,
  },
  {
    label: 'lịch đã tới hạn (đang công khai, chưa reconcile)',
    status: ContentStatus.PENDING,
    scheduledAt: PAST,
    publishedAt: PAST,
    editorMayEdit: false,
  },
  {
    label: 'đang đăng',
    status: ContentStatus.PUBLISHED,
    scheduledAt: null,
    publishedAt: PAST,
    editorMayEdit: false,
  },
  {
    label: 'nháp NHƯNG từng đăng (lịch sử thật)',
    status: ContentStatus.DRAFT,
    scheduledAt: null,
    publishedAt: PAST,
    editorMayEdit: false,
  },
];

describe('PagesService — quyền sửa nội dung sau khi có lịch đăng', () => {
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

  function given(state: (typeof STATES)[number]) {
    prisma.page.findUnique.mockResolvedValue({
      id: 'g1',
      slug: 'gioi-thieu',
      status: state.status,
      scheduledAt: state.scheduledAt,
      publishedAt: state.publishedAt,
    });
  }

  describe('EDITOR', () => {
    it.each(STATES.filter((state) => state.editorMayEdit))(
      'sửa được: $label',
      async (state) => {
        given(state);

        await service.update(
          'gioi-thieu',
          { title: { vi: 'Tiêu đề mới' } },
          Role.EDITOR,
        );

        expect(prisma.page.update).toHaveBeenCalled();
      },
    );

    it.each(STATES.filter((state) => !state.editorMayEdit))(
      'KHÔNG sửa được: $label → 403, không ghi gì',
      async (state) => {
        given(state);

        await expect(
          service.update(
            'gioi-thieu',
            { title: { vi: 'Tiêu đề mới' } },
            Role.EDITOR,
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.page.update).not.toHaveBeenCalled();
      },
    );

    /** §11: sửa nội dung không bao giờ kéo theo cột xuất bản nào. */
    it.each(STATES.filter((state) => state.editorMayEdit))(
      'sửa nội dung KHÔNG chạm ba cột xuất bản: $label',
      async (state) => {
        given(state);

        await service.update(
          'gioi-thieu',
          { title: { vi: 'Tiêu đề mới' } },
          Role.EDITOR,
        );

        const [{ data }] = prisma.page.update.mock.calls[0] as [
          { data: Record<string, unknown> },
        ];
        expect(data.status).toBeUndefined();
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

      await service.update(
        'gioi-thieu',
        { title: { vi: 'Tiêu đề mới' } },
        role,
      );

      expect(prisma.page.update).toHaveBeenCalled();
    });
  });

  describe('fail closed', () => {
    it('thiếu vai trò → 403 kể cả trên bản nháp sạch', async () => {
      given(STATES[0]);

      await expect(
        service.update('gioi-thieu', { title: { vi: 'X' } }, undefined),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.page.update).not.toHaveBeenCalled();
    });
  });
});
