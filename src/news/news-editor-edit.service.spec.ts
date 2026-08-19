import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentStatus, Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NewsService } from './news.service';
import { UpdateNewsPostDto } from './dto/update-news-post.dto';

/**
 * **Batch 8 — EDITOR không sửa được nội dung đã qua ranh giới duyệt/xuất bản.**
 *
 * Lỗ hổng quản trị được đóng ở đây:
 *
 * ```
 * 07:00  ADMIN đặt lịch đăng bài lúc 08:00
 * 07:59  EDITOR sửa bài                      ← trước batch này: được
 * 08:00  bản ĐÃ SỬA tự ra công khai
 * ```
 *
 * Bất biến phải giữ: bản mà ADMIN/SUPER_ADMIN đã hẹn giờ **chính là** bản ra
 * công khai — đúng ở cả ba mốc: chưa tới hạn, đúng hạn, và đã quá hạn mà
 * reconciler chưa chạy.
 *
 * Ma trận sáu ca ở `describe` đầu là phần bắt buộc; hai `describe` sau khoá hai
 * tính chất dễ vỡ khi refactor: **chặn TRƯỚC khi ghi**, và **ADMIN+ không bị
 * siết theo**.
 */

/** Mốc quá khứ (đã công khai thật) và mốc tương lai (lịch chưa tới hạn). */
const PAST = new Date('2026-08-01T01:00:00.000Z');
const FUTURE = new Date('2099-08-20T01:00:00.000Z');

const contentEdit: UpdateNewsPostDto = {
  title: { vi: 'Tiêu đề đã sửa', en: 'Edited title' },
};

/** Sáu trạng thái xuất bản của News, mô tả bằng đúng ba cột persisted. */
const states = {
  /** A — nháp chưa từng công khai. */
  draft: {
    status: ContentStatus.DRAFT,
    scheduledAt: null,
    publishedAt: null,
  },
  /** B — chờ duyệt, chưa được hẹn giờ. */
  pendingUnscheduled: {
    status: ContentStatus.PENDING,
    scheduledAt: null,
    publishedAt: null,
  },
  /** C — đã lên lịch, chưa tới hạn (bất biến D: publishedAt = scheduledAt). */
  scheduled: {
    status: ContentStatus.PENDING,
    scheduledAt: FUTURE,
    publishedAt: FUTURE,
  },
  /** D — lịch đã tới hạn, reconciler chưa kịp đổi `status`. */
  due: {
    status: ContentStatus.PENDING,
    scheduledAt: PAST,
    publishedAt: PAST,
  },
  /** E — đang đăng công khai. */
  published: {
    status: ContentStatus.PUBLISHED,
    scheduledAt: null,
    publishedAt: PAST,
  },
  /** F — từng đăng rồi bị gỡ về nháp; `publishedAt` là lịch sử thật. */
  historicalDraft: {
    status: ContentStatus.DRAFT,
    scheduledAt: null,
    publishedAt: PAST,
  },
} as const;

type StateKey = keyof typeof states;

describe('NewsService.update — ma trận quyền sửa của EDITOR', () => {
  let service: NewsService;
  let prisma: { newsPost: { findUnique: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      newsPost: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'n1' }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [NewsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(NewsService);
  });

  /** Nạp một trong sáu trạng thái vào "DB". */
  function given(state: StateKey) {
    prisma.newsPost.findUnique.mockResolvedValue({
      id: 'n1',
      slug: 'bai-viet',
      category: null,
      ...states[state],
    });
  }

  describe('cho phép — nội dung còn thật sự trong khâu biên tập', () => {
    it('1. nháp chưa từng công khai → sửa được', async () => {
      given('draft');

      await service.update('bai-viet', contentEdit, Role.EDITOR);

      expect(prisma.newsPost.update).toHaveBeenCalledTimes(1);
    });

    /**
     * Cố ý mở: chưa ai duyệt/hẹn giờ gì để mà phá vỡ, nên không bắt EDITOR nhờ
     * ADMIN cho từng lỗi chính tả lúc bài còn ở hàng chờ.
     */
    it('2. chờ duyệt, chưa hẹn giờ → sửa được', async () => {
      given('pendingUnscheduled');

      await service.update('bai-viet', contentEdit, Role.EDITOR);

      expect(prisma.newsPost.update).toHaveBeenCalledTimes(1);
    });

    it('nội dung sửa được ghi xuống nguyên vẹn', async () => {
      given('draft');

      await service.update('bai-viet', contentEdit, Role.EDITOR);

      const [{ data }] = prisma.newsPost.update.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(data.title).toMatchObject({ vi: 'Tiêu đề đã sửa' });
    });
  });

  describe('chặn — nội dung đã qua ranh giới duyệt/xuất bản', () => {
    /** Chính là lỗ hổng 07:59. */
    it('3. đã lên lịch (chưa tới hạn) → 403', async () => {
      given('scheduled');

      await expect(
        service.update('bai-viet', contentEdit, Role.EDITOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    /** Bài này theo vị từ hiển thị của Batch 2 ĐÃ ra công khai rồi. */
    it('4. lịch đã tới hạn, chưa đồng bộ → 403', async () => {
      given('due');

      await expect(
        service.update('bai-viet', contentEdit, Role.EDITOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('5. đang đăng công khai → 403', async () => {
      given('published');

      await expect(
        service.update('bai-viet', contentEdit, Role.EDITOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    /**
     * `status = DRAFT` một mình nói SAI: bài đã ra ngoài, đã được index, và
     * ADMIN đăng lại được bằng một cú bấm. `publishedAt` là thứ phân biệt nó với
     * một bản nháp thật sự chưa ai thấy.
     */
    it('6. nháp TỪNG đăng (publishedAt lịch sử) → 403', async () => {
      given('historicalDraft');

      await expect(
        service.update('bai-viet', contentEdit, Role.EDITOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('thông điệp 403 nói rõ lý do cho Admin CMS hiện lại', async () => {
      given('scheduled');

      await expect(
        service.update('bai-viet', contentEdit, Role.EDITOR),
      ).rejects.toThrow(/lên lịch hoặc đã xuất bản/);
    });
  });

  /**
   * §23 — phân quyền phải chạy TRƯỚC khi ghi. Nếu thứ tự bị đảo (ghi rồi mới
   * kiểm), test ở trên vẫn xanh vì lời gọi vẫn ném 403 — nhưng dữ liệu đã bị
   * sửa. Chỉ có phép kiểm này bắt được.
   */
  describe('không ghi gì sau khi bị từ chối', () => {
    it.each<StateKey>(['scheduled', 'due', 'published', 'historicalDraft'])(
      '%s: Prisma update KHÔNG được gọi',
      async (state) => {
        given(state);

        await expect(
          service.update('bai-viet', contentEdit, Role.EDITOR),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.newsPost.update).not.toHaveBeenCalled();
      },
    );
  });

  /**
   * §10 + §20 — luồng đính chính của quản trị KHÔNG được siết theo. Đây là
   * nghiệp vụ đang dùng: sửa gấp một bài đang chạy trên website.
   */
  describe('ADMIN / SUPER_ADMIN giữ nguyên quyền sửa', () => {
    const allStates = Object.keys(states) as StateKey[];

    it.each(allStates)('ADMIN sửa được ở trạng thái %s', async (state) => {
      given(state);

      await service.update('bai-viet', contentEdit, Role.ADMIN);

      expect(prisma.newsPost.update).toHaveBeenCalledTimes(1);
    });

    it.each(allStates)(
      'SUPER_ADMIN sửa được ở trạng thái %s',
      async (state) => {
        given(state);

        await service.update('bai-viet', contentEdit, Role.SUPER_ADMIN);

        expect(prisma.newsPost.update).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe('nguồn vai trò', () => {
    /**
     * Vai trò đến từ token đã xác thực (controller truyền vào). Thiếu vai trò
     * thì fail closed — không được rơi về "coi như quản trị".
     */
    it('thiếu vai trò → 403 kể cả với bản nháp sạch', async () => {
      given('draft');

      await expect(
        service.update('bai-viet', contentEdit),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.newsPost.update).not.toHaveBeenCalled();
    });

    it('biến thể sai chính tả của vai trò không lấy được quyền ADMIN', async () => {
      given('published');

      await expect(
        service.update('bai-viet', contentEdit, 'Admin'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  /**
   * §24 — không tạo lỗ hở về sự tồn tại. Bản ghi không có vẫn là 404 như trước,
   * quyết định trước cả phép kiểm quyền, vì `findBySlug` là bước đầu tiên.
   */
  it('bài không tồn tại vẫn trả 404 (không đổi thành 403)', async () => {
    prisma.newsPost.findUnique.mockResolvedValue(null);

    await expect(
      service.update('khong-co', contentEdit, Role.EDITOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
