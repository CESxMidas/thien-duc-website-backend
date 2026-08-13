import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentStatus, Role } from '../../generated/prisma/client';
import { isPubliclyVisible } from '../common/publication';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAX_SCHEDULE_HORIZON_MS,
  MIN_SCHEDULE_LEAD_MS,
  NewsService,
} from './news.service';

/**
 * Lệnh đặt / huỷ lịch đăng (Batch 3) — đường GHI duy nhất chạm tới `scheduledAt`.
 *
 * Bất biến trung tâm mà cả file này bảo vệ:
 *
 *     scheduledAt != null  ⇒  publishedAt = scheduledAt
 *
 * Nó bắt buộc vì Batch 2 cho một bài PENDING đã tới hạn ra công khai **trước
 * khi** reconciler chạy. Tới lúc đó `publishedAt` phải sẵn sàng, nếu không bài
 * xuất hiện với thứ tự sai (Postgres xếp NULL lên đầu ở `ORDER BY ... DESC`),
 * tụt xuống đáy kết quả tìm kiếm (`NULLS LAST`) và không có `lastModified` cho
 * sitemap.
 *
 * Đồng hồ đóng băng ở 08:00 giờ VN cho mọi ca — không `sleep`, không phụ thuộc
 * giờ chạy CI.
 */
const NOW = new Date('2026-08-20T01:00:00.000Z'); // 08:00 giờ VN
const HOUR = 60 * 60 * 1000;

/** Một mốc hợp lệ: 2 giờ nữa, viết theo giờ Việt Nam. */
const VALID_ISO = new Date(NOW.getTime() + 2 * HOUR).toISOString();

describe('NewsService — lệnh đặt/huỷ lịch đăng', () => {
  let service: NewsService;
  let prisma: {
    newsPost: { findUnique: jest.Mock; update: jest.Mock };
  };

  /** Bản ghi hiện có trong DB cho `findBySlug`. */
  function givenPost(post: {
    status: ContentStatus;
    scheduledAt?: Date | null;
    publishedAt?: Date | null;
  }) {
    prisma.newsPost.findUnique.mockResolvedValue({
      id: 'n1',
      slug: 'bai-viet',
      scheduledAt: null,
      publishedAt: null,
      ...post,
    });
  }

  function lastUpdateData(): {
    status?: ContentStatus;
    scheduledAt?: Date | null;
    publishedAt?: Date | null;
  } {
    const calls = prisma.newsPost.update.mock.calls;
    const [{ data }] = calls[calls.length - 1] as [{ data: never }];
    return data;
  }

  beforeEach(async () => {
    prisma = { newsPost: { findUnique: jest.fn(), update: jest.fn() } };
    prisma.newsPost.update.mockImplementation(
      (args: { data: Record<string, unknown> }) => ({ id: 'n1', ...args.data }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [NewsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(NewsService);

    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /* ----------------------------- Đặt lịch ------------------------------ */

  describe('schedulePublication — ghi trạng thái', () => {
    it.each([
      ['từ DRAFT', ContentStatus.DRAFT],
      ['từ PENDING', ContentStatus.PENDING],
    ])(
      '%s: ghi PENDING + scheduledAt + publishedAt cùng một mốc',
      async (_label, status) => {
        givenPost({ status });

        await service.schedulePublication('bai-viet', VALID_ISO);

        const data = lastUpdateData();
        expect(data.status).toBe(ContentStatus.PENDING);
        expect(data.scheduledAt).toEqual(new Date(VALID_ISO));
        // Bất biến D — hai cột phải bằng nhau, không chỉ "cùng có giá trị".
        expect(data.publishedAt).toEqual(data.scheduledAt);
      },
    );

    it('ghi nguyên tử trong MỘT câu update, không transaction trang trí', async () => {
      givenPost({ status: ContentStatus.DRAFT });

      await service.schedulePublication('bai-viet', VALID_ISO);

      expect(prisma.newsPost.update).toHaveBeenCalledTimes(1);
    });

    it('đổi lịch: ghi đè CẢ hai mốc bằng giá trị mới', async () => {
      const oldSchedule = new Date(NOW.getTime() + HOUR);
      givenPost({
        status: ContentStatus.PENDING,
        scheduledAt: oldSchedule,
        publishedAt: oldSchedule,
      });
      const newIso = new Date(NOW.getTime() + 5 * HOUR).toISOString();

      await service.schedulePublication('bai-viet', newIso);

      const data = lastUpdateData();
      expect(data.scheduledAt).toEqual(new Date(newIso));
      expect(data.publishedAt).toEqual(new Date(newIso));
    });

    it('bài đang PUBLISHED bị từ chối 409, KHÔNG ghi gì', async () => {
      givenPost({
        status: ContentStatus.PUBLISHED,
        publishedAt: new Date('2026-07-01T00:00:00Z'),
      });

      await expect(
        service.schedulePublication('bai-viet', VALID_ISO),
      ).rejects.toThrow(ConflictException);
      // Quan trọng nhất: một URL đang được index không bị âm thầm chuyển sang
      // PENDING và biến mất khỏi website.
      expect(prisma.newsPost.update).not.toHaveBeenCalled();
    });

    it('slug không tồn tại: 404 như mọi route khác', async () => {
      prisma.newsPost.findUnique.mockResolvedValue(null);

      await expect(
        service.schedulePublication('khong-co-that', VALID_ISO),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('schedulePublication — luật thời gian', () => {
    it.each([
      ['quá khứ', -HOUR],
      ['đúng bây giờ', 0],
      ['30 giây nữa (dưới ngưỡng 60s)', 30_000],
      ['59 giây nữa', 59_000],
    ])('%s → 400', async (_label, offsetMs) => {
      givenPost({ status: ContentStatus.DRAFT });
      const iso = new Date(NOW.getTime() + offsetMs).toISOString();

      await expect(
        service.schedulePublication('bai-viet', iso),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.newsPost.update).not.toHaveBeenCalled();
    });

    it('đúng ngưỡng tối thiểu 60 giây → CHẤP NHẬN (biên là >=)', async () => {
      givenPost({ status: ContentStatus.DRAFT });
      const iso = new Date(NOW.getTime() + MIN_SCHEDULE_LEAD_MS).toISOString();

      await expect(
        service.schedulePublication('bai-viet', iso),
      ).resolves.toBeDefined();
    });

    it('đúng trần 2 năm → chấp nhận; vượt trần → 400', async () => {
      givenPost({ status: ContentStatus.DRAFT });
      const atLimit = new Date(
        NOW.getTime() + MAX_SCHEDULE_HORIZON_MS,
      ).toISOString();
      const beyond = new Date(
        NOW.getTime() + MAX_SCHEDULE_HORIZON_MS + 60_000,
      ).toISOString();

      await expect(
        service.schedulePublication('bai-viet', atLimit),
      ).resolves.toBeDefined();
      await expect(
        service.schedulePublication('bai-viet', beyond),
      ).rejects.toThrow(BadRequestException);
    });

    it('gõ nhầm năm (2126 thay vì 2026) bị chặn', async () => {
      givenPost({ status: ContentStatus.DRAFT });

      await expect(
        service.schedulePublication('bai-viet', '2126-08-20T08:00:00+07:00'),
      ).rejects.toThrow(BadRequestException);
    });

    it('08:00 giờ VN lưu thành 01:00 UTC — cùng một instant', async () => {
      givenPost({ status: ContentStatus.DRAFT });
      // Ngày mai theo giờ VN, để vượt ngưỡng lead time.
      await service.schedulePublication(
        'bai-viet',
        '2026-08-21T08:00:00+07:00',
      );

      expect(lastUpdateData().scheduledAt?.toISOString()).toBe(
        '2026-08-21T01:00:00.000Z',
      );
    });

    it('cùng một instant viết bằng Z hay +07:00 đều lưu giống hệt nhau', async () => {
      givenPost({ status: ContentStatus.DRAFT });
      await service.schedulePublication(
        'bai-viet',
        '2026-08-21T08:00:00+07:00',
      );
      const viaOffset = lastUpdateData().scheduledAt;

      givenPost({ status: ContentStatus.DRAFT });
      await service.schedulePublication('bai-viet', '2026-08-21T01:00:00Z');
      const viaZulu = lastUpdateData().scheduledAt;

      expect(viaOffset).toEqual(viaZulu);
    });
  });

  /* ------------------- Lịch sử xuất bản không bị ghi đè ----------------- */

  /**
   * Ranh giới quan trọng nhất của v1: **chỉ nội dung CHƯA TỪNG công khai mới đặt
   * lịch được.**
   *
   * `publishedAt` ở dự án này luôn có nghĩa "lần công khai ĐẦU TIÊN" — Batch 1
   * và Batch 2 đều giữ nguyên mốc đó qua mọi lần đăng lại. Cho phép hẹn giờ một
   * bài từng đăng sẽ ghi đè mốc ấy, tức âm thầm định nghĩa lại field thành "lần
   * đăng gần nhất", và trả lời ngầm cả loạt câu hỏi của nghiệp vụ *đăng lại*
   * (thứ tự trang tin, `datePublished` của JSON-LD, `lastModified` của sitemap,
   * xếp hạng tìm kiếm) mà schema chưa có bảng phiên bản nào để trả lời.
   *
   * Cái khó: chính lệnh đặt lịch cũng ghi `publishedAt`. Nên "có `publishedAt`"
   * KHÔNG đủ để kết luận là lịch sử — phải tách được *dự định của một lịch đang
   * chờ* khỏi *sự kiện đã xảy ra*, nếu không thì không bài nào đổi lịch được nữa.
   */
  describe('chỉ bài CHƯA TỪNG công khai mới đặt lịch được', () => {
    const HISTORICAL = new Date('2020-05-01T00:00:00.000Z');
    const FUTURE_A = new Date(NOW.getTime() + 2 * HOUR);

    it('CASE 1 — DRAFT, chưa có mốc nào: CHO PHÉP', async () => {
      givenPost({ status: ContentStatus.DRAFT });

      await expect(
        service.schedulePublication('bai-viet', VALID_ISO),
      ).resolves.toBeDefined();
    });

    it('CASE 2 — PENDING, chưa có mốc nào: CHO PHÉP', async () => {
      givenPost({ status: ContentStatus.PENDING });

      await expect(
        service.schedulePublication('bai-viet', VALID_ISO),
      ).resolves.toBeDefined();
    });

    it('CASE 3 — đang có lịch tương lai hợp lệ: ĐỔI LỊCH ĐƯỢC', async () => {
      givenPost({
        status: ContentStatus.PENDING,
        scheduledAt: FUTURE_A,
        publishedAt: FUTURE_A,
      });
      const futureB = new Date(NOW.getTime() + 6 * HOUR).toISOString();

      await service.schedulePublication('bai-viet', futureB);

      // Đây là ca dễ hỏng nhất: siết "có publishedAt ⇒ từ chối" mà không tách
      // được lịch đang chờ sẽ khoá cứng mọi lịch đã đặt, không sửa được nữa.
      const data = lastUpdateData();
      expect(data.scheduledAt).toEqual(new Date(futureB));
      expect(data.publishedAt).toEqual(new Date(futureB));
    });

    it.each([
      ['CASE 4 — PUBLISHED + mốc lịch sử', ContentStatus.PUBLISHED],
      ['CASE 5 — DRAFT + mốc lịch sử (đã gỡ về nháp)', ContentStatus.DRAFT],
      ['CASE 6 — PENDING + mốc lịch sử', ContentStatus.PENDING],
    ])('%s: TỪ CHỐI 409, không ghi gì', async (_label, status) => {
      givenPost({ status, scheduledAt: null, publishedAt: HISTORICAL });

      await expect(
        service.schedulePublication('bai-viet', VALID_ISO),
      ).rejects.toThrow(ConflictException);
      expect(prisma.newsPost.update).not.toHaveBeenCalled();
    });

    it('CASE 7 — DRAFT + mốc lịch sử + lịch tương lai dị dạng: TỪ CHỐI', async () => {
      // Tổ hợp không thể sinh ra từ code hiện tại, nhưng dữ liệu cũ có thể có.
      // `status` là DRAFT nên đây không phải lịch hợp lệ; mốc 2020 là lịch sử
      // thật và không được ghi đè chỉ vì hàng có `scheduledAt`.
      givenPost({
        status: ContentStatus.DRAFT,
        scheduledAt: FUTURE_A,
        publishedAt: HISTORICAL,
      });

      await expect(
        service.schedulePublication('bai-viet', VALID_ISO),
      ).rejects.toThrow(ConflictException);
      expect(prisma.newsPost.update).not.toHaveBeenCalled();
    });

    it('mốc tương lai KHÁC scheduledAt không được coi là lịch hợp lệ', async () => {
      // `publishedAt` phải ĐÚNG BẰNG `scheduledAt` mới là dấu vết của lệnh đặt
      // lịch. Lệch nhau nghĩa là hàng đến từ đường khác — không ghi đè.
      givenPost({
        status: ContentStatus.PENDING,
        scheduledAt: FUTURE_A,
        publishedAt: new Date(FUTURE_A.getTime() + 1),
      });

      await expect(
        service.schedulePublication('bai-viet', VALID_ISO),
      ).rejects.toThrow(ConflictException);
    });

    it('lịch ĐÃ QUÁ HẠN không còn là "lịch đang chờ" — bài đã công khai', async () => {
      const past = new Date(NOW.getTime() - HOUR);
      givenPost({
        status: ContentStatus.PENDING,
        scheduledAt: past,
        publishedAt: past,
      });

      // Theo vị từ Batch 2 bài này đã hiển thị công khai, nên mốc của nó đã
      // thành sự thật — đặt lịch lại chính là đăng lại.
      await expect(
        service.schedulePublication('bai-viet', VALID_ISO),
      ).rejects.toThrow(ConflictException);
    });
  });

  /* ------------------------------ Huỷ lịch ----------------------------- */

  describe('cancelScheduledPublication', () => {
    it('lịch chưa tới hạn: về DRAFT, xoá cả scheduledAt lẫn publishedAt', async () => {
      const future = new Date(NOW.getTime() + 2 * HOUR);
      givenPost({
        status: ContentStatus.PENDING,
        scheduledAt: future,
        publishedAt: future,
      });

      await service.cancelScheduledPublication('bai-viet');

      const data = lastUpdateData();
      expect(data.status).toBe(ContentStatus.DRAFT);
      expect(data.scheduledAt).toBeNull();
      // Mốc đó chưa bao giờ thành sự thật — xoá để bài về nháp sạch.
      expect(data.publishedAt).toBeNull();
    });

    it('bài không có lịch: 409, không ghi', async () => {
      givenPost({ status: ContentStatus.DRAFT, scheduledAt: null });

      await expect(
        service.cancelScheduledPublication('bai-viet'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.newsPost.update).not.toHaveBeenCalled();
    });

    it('lịch ĐÃ qua giờ: 409 — lúc này là gỡ bài công khai, không phải huỷ lịch', async () => {
      const past = new Date(NOW.getTime() - HOUR);
      givenPost({
        status: ContentStatus.PENDING,
        scheduledAt: past,
        publishedAt: past,
      });

      await expect(
        service.cancelScheduledPublication('bai-viet'),
      ).rejects.toThrow(ConflictException);
      // Không âm thầm xoá mốc lịch sử của một bài đã thật sự ra ngoài.
      expect(prisma.newsPost.update).not.toHaveBeenCalled();
    });

    it('đúng khoảnh khắc đáo hạn cũng bị từ chối (bài đã công khai theo Batch 2)', async () => {
      givenPost({
        status: ContentStatus.PENDING,
        scheduledAt: new Date(NOW.getTime()),
        publishedAt: new Date(NOW.getTime()),
      });

      await expect(
        service.cancelScheduledPublication('bai-viet'),
      ).rejects.toThrow(ConflictException);
    });

    it('slug không tồn tại: 404', async () => {
      prisma.newsPost.findUnique.mockResolvedValue(null);

      await expect(
        service.cancelScheduledPublication('khong-co-that'),
      ).rejects.toThrow(NotFoundException);
    });

    it('bài từng công khai bị gán lịch tương lai: TỪ CHỐI, không xoá mốc lịch sử', async () => {
      // Nhánh huỷ hợp lệ xoá `publishedAt`. Nếu để hàng này đi qua đó, mốc 2020
      // — lịch sử xuất bản thật — sẽ bị xoá mất mà không có đường khôi phục.
      givenPost({
        status: ContentStatus.DRAFT,
        scheduledAt: new Date(NOW.getTime() + 2 * HOUR),
        publishedAt: new Date('2020-05-01T00:00:00.000Z'),
      });

      await expect(
        service.cancelScheduledPublication('bai-viet'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.newsPost.update).not.toHaveBeenCalled();
    });
  });

  /* --------------------- Đăng ngay từ bài đang hẹn --------------------- */

  describe('Đăng ngay (updateStatus → PUBLISHED)', () => {
    it('bài hẹn tương lai: publishedAt = BÂY GIỜ, không phải mốc đã hẹn', async () => {
      const future = new Date(NOW.getTime() + 2 * HOUR);
      givenPost({
        status: ContentStatus.PENDING,
        scheduledAt: future,
        publishedAt: future,
      });

      await service.updateStatus(
        'bai-viet',
        ContentStatus.PUBLISHED,
        Role.ADMIN,
      );

      const data = lastUpdateData();
      expect(data.status).toBe(ContentStatus.PUBLISHED);
      expect(data.scheduledAt).toBeNull();
      // Giữ lại mốc tương lai sẽ đẩy bài lên sai vị trí trong danh sách và khai
      // ngày xuất bản chưa tới trong JSON-LD/sitemap.
      expect(data.publishedAt).toEqual(NOW);
    });

    it('bài từng công khai thật: GIỮ mốc lịch sử (không đổi hành vi cũ)', async () => {
      const historical = new Date('2026-07-01T00:00:00Z');
      givenPost({
        status: ContentStatus.DRAFT,
        scheduledAt: null,
        publishedAt: historical,
      });

      await service.updateStatus(
        'bai-viet',
        ContentStatus.PUBLISHED,
        Role.ADMIN,
      );

      expect(lastUpdateData().publishedAt).toEqual(historical);
    });

    it('bài chưa từng có mốc nào: publishedAt = bây giờ', async () => {
      givenPost({ status: ContentStatus.DRAFT, publishedAt: null });

      await service.updateStatus(
        'bai-viet',
        ContentStatus.PUBLISHED,
        Role.ADMIN,
      );

      expect(lastUpdateData().publishedAt).toEqual(NOW);
    });
  });

  /* ------------------------- Trả về nháp ------------------------------- */

  describe('Trả về nháp (updateStatus → DRAFT)', () => {
    it('bài hẹn tương lai: xoá cả lịch lẫn mốc chưa thành sự thật', async () => {
      const future = new Date(NOW.getTime() + 2 * HOUR);
      givenPost({
        status: ContentStatus.PENDING,
        scheduledAt: future,
        publishedAt: future,
      });

      await service.updateStatus('bai-viet', ContentStatus.DRAFT, Role.ADMIN);

      const data = lastUpdateData();
      expect(data.scheduledAt).toBeNull();
      expect(data.publishedAt).toBeNull();
    });

    it('bài tới hạn mà reconciler chưa chạy: GIỮ publishedAt — nó ĐÃ công khai', async () => {
      const past = new Date(NOW.getTime() - HOUR);
      givenPost({
        status: ContentStatus.PENDING,
        scheduledAt: past,
        publishedAt: past,
      });

      // Batch 2 đã cho bài này hiển thị từ lúc `past`. Nó ra ngoài thật, dù
      // `status` chưa kịp thành PUBLISHED — xoá mốc là xoá mất sự thật đó.
      expect(
        isPubliclyVisible(
          { status: ContentStatus.PENDING, scheduledAt: past },
          NOW,
        ),
      ).toBe(true);

      await service.updateStatus('bai-viet', ContentStatus.DRAFT, Role.ADMIN);

      const data = lastUpdateData();
      expect(data.scheduledAt).toBeNull();
      expect(data.publishedAt).toEqual(past);
    });
  });

  /* ------------------------- Bất biến tổng hợp ------------------------- */

  describe('bất biến sau mỗi lệnh', () => {
    it('D: đặt lịch xong thì scheduledAt và publishedAt luôn bằng nhau', async () => {
      givenPost({ status: ContentStatus.DRAFT });
      await service.schedulePublication('bai-viet', VALID_ISO);

      const { scheduledAt, publishedAt } = lastUpdateData();
      expect(scheduledAt).toEqual(publishedAt);
    });

    it('A: mọi đường về DRAFT đều để scheduledAt = NULL', async () => {
      const future = new Date(NOW.getTime() + 2 * HOUR);

      givenPost({
        status: ContentStatus.PENDING,
        scheduledAt: future,
        publishedAt: future,
      });
      await service.cancelScheduledPublication('bai-viet');
      expect(lastUpdateData().scheduledAt).toBeNull();

      givenPost({
        status: ContentStatus.PENDING,
        scheduledAt: future,
        publishedAt: future,
      });
      await service.updateStatus('bai-viet', ContentStatus.DRAFT, Role.ADMIN);
      expect(lastUpdateData().scheduledAt).toBeNull();
    });

    it('E: đăng ngay luôn để scheduledAt = NULL và publishedAt != NULL', async () => {
      givenPost({
        status: ContentStatus.PENDING,
        scheduledAt: new Date(NOW.getTime() + HOUR),
        publishedAt: new Date(NOW.getTime() + HOUR),
      });

      await service.updateStatus(
        'bai-viet',
        ContentStatus.PUBLISHED,
        Role.ADMIN,
      );

      const data = lastUpdateData();
      expect(data.scheduledAt).toBeNull();
      expect(data.publishedAt).not.toBeNull();
    });

    it('F/G: bài vừa đặt lịch là RIÊNG TƯ, tới hạn thì CÔNG KHAI', async () => {
      givenPost({ status: ContentStatus.DRAFT });
      await service.schedulePublication('bai-viet', VALID_ISO);
      const { status, scheduledAt } = lastUpdateData();

      const scheduled = {
        status: status as ContentStatus,
        scheduledAt: scheduledAt as Date,
      };
      expect(isPubliclyVisible(scheduled, NOW)).toBe(false);
      expect(
        isPubliclyVisible(scheduled, new Date(scheduledAt!.getTime())),
      ).toBe(true);
    });
  });
});
