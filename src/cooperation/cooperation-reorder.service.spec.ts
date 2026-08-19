import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentStatus, Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CooperationService } from './cooperation.service';

/**
 * **Batch 10 — `PATCH /cooperation/reorder` chịu chốt quyền xuất bản.**
 *
 * ## Vì sao
 *
 * `order` **là nội dung công khai**: nó quyết định thứ tự các thẻ chạy trong
 * section "Dự án hợp tác" ở trang chủ, và thẻ đầu tiên là thẻ người xem thấy
 * trước. Trước batch này route mở cho EDITOR mà không xét trạng thái, nên một
 * EDITOR không sửa được nội dung của bản đã đăng vẫn kéo được nó từ vị trí 1
 * xuống cuối — chốt quyền của Batch 8 chỉ còn là hình thức. Đúng cùng một lỗ
 * hổng đã vá ở `reorderGallery` của Dự án (Batch 9).
 *
 * ## Hệ quả của việc lệnh này đòi ĐỦ danh sách
 *
 * `reorder` bắt gửi id của **mọi** dự án hợp tác (thiếu một bản là 400, vì bản
 * vắng mặt sẽ giữ `order` cũ và xen vào giữa dãy mới). Cộng với luật mới, hệ
 * quả thực tế là: **EDITOR chỉ sắp xếp được khi mọi dự án hợp tác còn đang
 * trong khâu biên tập.** Đây là kết luận đúng chứ không phải tác dụng phụ — một
 * khi đã có bản chạy trên trang chủ thì mọi thay đổi thứ tự đều là thay đổi nội
 * dung công khai.
 *
 * ## Thứ tự bắt buộc
 *
 * Nạp bản ghi → xét quyền trên trạng thái ĐÃ LƯU → mới ghi. Không bao giờ tin
 * `contentStatus` do client gửi (thân request ở đây chỉ có id, và phải giữ
 * nguyên như vậy). Từ chối là **không ghi một dòng nào**.
 */

const NOW = new Date('2026-08-13T10:00:00.000Z');
const PAST = new Date('2026-08-13T09:00:00.000Z');
const FUTURE = new Date('2026-08-14T10:00:00.000Z');

/** Các hình dạng bản ghi dùng để dựng danh sách. */
const RECORDS = {
  draft: {
    contentStatus: ContentStatus.DRAFT,
    scheduledAt: null,
    publishedAt: null,
  },
  pendingUnscheduled: {
    contentStatus: ContentStatus.PENDING,
    scheduledAt: null,
    publishedAt: null,
  },
  scheduled: {
    contentStatus: ContentStatus.PENDING,
    scheduledAt: FUTURE,
    publishedAt: FUTURE,
  },
  due: {
    contentStatus: ContentStatus.PENDING,
    scheduledAt: PAST,
    publishedAt: PAST,
  },
  published: {
    contentStatus: ContentStatus.PUBLISHED,
    scheduledAt: null,
    publishedAt: PAST,
  },
  historicalDraft: {
    contentStatus: ContentStatus.DRAFT,
    scheduledAt: null,
    publishedAt: PAST,
  },
};

describe('CooperationService.reorder — chốt quyền theo trạng thái xuất bản', () => {
  let service: CooperationService;
  let prisma: {
    cooperationProject: {
      count: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(NOW);

    prisma = {
      cooperationProject: {
        count: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue([]),
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

  /**
   * Dựng danh sách gồm đúng những bản ghi cho trước. `findMany` được gọi hai
   * lần trong luồng thành công: một lần để xét quyền, một lần ở `findAll()`
   * cuối hàm — nên trả cùng giá trị cho mọi lời gọi.
   */
  function givenList(records: (typeof RECORDS)[keyof typeof RECORDS][]) {
    prisma.cooperationProject.count.mockResolvedValue(records.length);
    prisma.cooperationProject.findMany.mockResolvedValue(records);
    return records.map((_, index) => `c${index + 1}`);
  }

  /** Không một lệnh ghi nào được phát ra. */
  function expectNoWrites() {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.cooperationProject.update).not.toHaveBeenCalled();
  }

  describe('EDITOR', () => {
    it('sắp xếp được khi TẤT CẢ còn là nháp chưa từng công khai', async () => {
      const ids = givenList([RECORDS.draft, RECORDS.draft]);

      await service.reorder(ids, Role.EDITOR);

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('sắp xếp được khi TẤT CẢ là chờ duyệt chưa hẹn giờ', async () => {
      const ids = givenList([
        RECORDS.pendingUnscheduled,
        RECORDS.pendingUnscheduled,
      ]);

      await service.reorder(ids, Role.EDITOR);

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it.each([
      ['đã lên lịch', RECORDS.scheduled],
      ['lịch đã tới hạn', RECORDS.due],
      ['đang đăng', RECORDS.published],
      ['nháp từng đăng', RECORDS.historicalDraft],
    ])(
      'bị chặn khi danh sách có MỘT bản %s → 403, không ghi gì',
      async (_label, blocking) => {
        const ids = givenList([RECORDS.draft, blocking, RECORDS.draft]);

        await expect(service.reorder(ids, Role.EDITOR)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expectNoWrites();
      },
    );

    /**
     * Chốt "kiểm hết TRƯỚC khi ghi": bản cản trở nằm ở CUỐI danh sách cũng phải
     * chặn được cả lệnh. Một hiện thực ghi dần rồi mới gặp lỗi sẽ để lại thứ tự
     * sai một nửa.
     */
    it('bản cản trở nằm cuối danh sách vẫn chặn toàn bộ lệnh', async () => {
      const ids = givenList([RECORDS.draft, RECORDS.draft, RECORDS.published]);

      await expect(service.reorder(ids, Role.EDITOR)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expectNoWrites();
    });
  });

  describe('ADMIN / SUPER_ADMIN — quyền không đổi', () => {
    it.each([Role.ADMIN, Role.SUPER_ADMIN])(
      '%s sắp xếp được kể cả khi danh sách có bản đã đăng và đã lên lịch',
      async (role) => {
        const ids = givenList([
          RECORDS.published,
          RECORDS.scheduled,
          RECORDS.draft,
        ]);

        await service.reorder(ids, role);

        expect(prisma.$transaction).toHaveBeenCalled();
      },
    );
  });

  describe('fail closed', () => {
    it('thiếu vai trò → 403 kể cả khi mọi bản đều là nháp', async () => {
      const ids = givenList([RECORDS.draft, RECORDS.draft]);

      await expect(service.reorder(ids, undefined)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expectNoWrites();
    });
  });

  describe('kiểm tra hình dạng danh sách vẫn giữ nguyên (Batch cũ)', () => {
    it('id trùng lặp → 400', async () => {
      prisma.cooperationProject.count.mockResolvedValue(2);

      await expect(
        service.reorder(['c1', 'c1'], Role.ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
      expectNoWrites();
    });

    it('gửi thiếu bản ghi → 400', async () => {
      prisma.cooperationProject.count.mockResolvedValue(3);

      await expect(
        service.reorder(['c1', 'c2'], Role.ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
      expectNoWrites();
    });

    it('có id không tồn tại → 400', async () => {
      prisma.cooperationProject.count.mockResolvedValue(2);
      prisma.cooperationProject.findMany.mockResolvedValue([RECORDS.draft]);

      await expect(
        service.reorder(['c1', 'c2'], Role.ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
      expectNoWrites();
    });

    /**
     * Quyền phải xét trên trạng thái ĐÃ LƯU. Truy vấn nạp bản ghi buộc phải lấy
     * đủ ba cột xuất bản — thiếu một cột là vị từ đọc `undefined` và cho ra câu
     * trả lời sai (thường là chặn nhầm, nhưng vẫn là sai).
     */
    it('nạp đủ ba cột xuất bản để xét quyền', async () => {
      const ids = givenList([RECORDS.draft]);

      await service.reorder(ids, Role.EDITOR);

      const [{ select }] = prisma.cooperationProject.findMany.mock.calls[0] as [
        { select: Record<string, boolean> },
      ];
      expect(select).toEqual({
        contentStatus: true,
        scheduledAt: true,
        publishedAt: true,
      });
    });
  });
});
