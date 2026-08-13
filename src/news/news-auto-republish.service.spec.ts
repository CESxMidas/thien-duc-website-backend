import { Test } from '@nestjs/testing';
import { ContentStatus, Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NewsService } from './news.service';

/**
 * Hồi quy — **bài đã gỡ về nháp không được tự đăng lại.**
 *
 * Lỗi trước batch này: `updateStatus` không đụng tới `scheduledAt`. Một bài
 * từng lên lịch, đã đăng, rồi được ADMIN bấm "Trả về nháp" vẫn giữ nguyên
 * `scheduled_at` ở quá khứ. `NewsSchedulerService` khớp
 * `status <> 'PUBLISHED' AND scheduled_at <= NOW()` → lượt cron kế tiếp (≤5
 * phút) đăng lại đúng bài mà ADMIN vừa chủ động gỡ xuống.
 *
 * Bài test chứng minh đầu kia của cặp đôi đó: sau khi gỡ về nháp, `scheduledAt`
 * bị ghi `null`, nên hàng không còn khớp mệnh đề `scheduled_at IS NOT NULL` của
 * scheduler. Hợp đồng phía scheduler được khoá riêng ở
 * `news-scheduler.service.spec.ts`.
 */
describe('NewsService.updateStatus — dọn lịch để không tự đăng lại', () => {
  let service: NewsService;
  let prisma: { newsPost: { findUnique: jest.Mock; update: jest.Mock } };

  /** Đồng hồ cố định để `publishedAt` quá khứ/tương lai là xác định. */
  const NOW = new Date('2026-08-20T01:00:00.000Z'); // 08:00 giờ VN
  const PAST = new Date('2026-07-01T00:00:00.000Z');

  /**
   * Bài đã lên lịch trong QUÁ KHỨ và đã thật sự công khai — đúng tiền đề của lỗi.
   *
   * `publishedAt` nằm ở quá khứ là điều kiện quan trọng: từ Batch 3, mốc quá khứ
   * nghĩa là bài **đã từng ra ngoài**, nên nó là lịch sử phải giữ. Mốc tương lai
   * thì ngược lại — chỉ là ý định của một lịch chưa tới hạn, và bị xoá khi trả
   * bài về nháp (khoá riêng ở `news-schedule-command.service.spec.ts`).
   */
  const scheduledAndPublished = {
    id: 'n1',
    slug: 'bai-da-len-lich',
    status: ContentStatus.PUBLISHED,
    publishedAt: PAST,
    scheduledAt: PAST,
  };

  /** Đọc `data` của lời gọi `prisma.newsPost.update` gần nhất. */
  function lastUpdateData(): {
    status: ContentStatus;
    publishedAt?: Date | null;
    scheduledAt?: Date | null;
  } {
    const calls = prisma.newsPost.update.mock.calls;
    const [{ data }] = calls[calls.length - 1] as [{ data: never }];
    return data;
  }

  beforeEach(async () => {
    prisma = { newsPost: { findUnique: jest.fn(), update: jest.fn() } };

    const moduleRef = await Test.createTestingModule({
      providers: [NewsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(NewsService);
    prisma.newsPost.update.mockImplementation(
      (args: { data: Record<string, unknown> }) => ({ id: 'n1', ...args.data }),
    );
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('PUBLISHED → DRAFT: xoá scheduledAt (bài KHÔNG thể tự đăng lại)', async () => {
    prisma.newsPost.findUnique.mockResolvedValue(scheduledAndPublished);

    await service.updateStatus(
      'bai-da-len-lich',
      ContentStatus.DRAFT,
      Role.ADMIN,
    );

    const data = lastUpdateData();
    expect(data.status).toBe(ContentStatus.DRAFT);
    expect(data.scheduledAt).toBeNull();
  });

  it('PUBLISHED → DRAFT: GIỮ NGUYÊN publishedAt — không đổi ngữ nghĩa sẵn có', async () => {
    prisma.newsPost.findUnique.mockResolvedValue(scheduledAndPublished);

    await service.updateStatus(
      'bai-da-len-lich',
      ContentStatus.DRAFT,
      Role.ADMIN,
    );

    // `publishedAt` = mốc công khai LẦN ĐẦU. Batch này cố ý không xoá nó: đó là
    // hành vi đang có (đã được khoá ở `news.service.spec.ts`) và việc xoá không
    // cần thiết để chặn tự đăng lại — chỉ `scheduledAt` mới khiến scheduler khớp.
    expect(lastUpdateData().publishedAt).toBe(
      scheduledAndPublished.publishedAt,
    );
  });

  it('→ PUBLISHED (đăng ngay khi đang có lịch): xoá scheduledAt, lịch cũ không còn ý nghĩa', async () => {
    prisma.newsPost.findUnique.mockResolvedValue({
      ...scheduledAndPublished,
      status: ContentStatus.PENDING,
      publishedAt: null,
    });

    await service.updateStatus(
      'bai-da-len-lich',
      ContentStatus.PUBLISHED,
      Role.ADMIN,
    );

    const data = lastUpdateData();
    expect(data.status).toBe(ContentStatus.PUBLISHED);
    expect(data.scheduledAt).toBeNull();
    expect(data.publishedAt).toBeInstanceOf(Date);
  });

  it('→ PENDING: KHÔNG đụng tới scheduledAt (PENDING + scheduledAt chính là trạng thái đã lên lịch)', async () => {
    prisma.newsPost.findUnique.mockResolvedValue({
      ...scheduledAndPublished,
      status: ContentStatus.DRAFT,
      publishedAt: null,
      scheduledAt: null,
    });

    await service.updateStatus(
      'bai-da-len-lich',
      ContentStatus.PENDING,
      Role.EDITOR,
    );

    // `undefined` = Prisma không ghi vào cột. Gửi duyệt không được âm thầm huỷ
    // lịch, và cũng không được tự bịa ra một lịch.
    expect(lastUpdateData().scheduledAt).toBeUndefined();
  });

  it('EDITOR không đăng được → không có lời gọi ghi nào, lịch giữ nguyên', async () => {
    prisma.newsPost.findUnique.mockResolvedValue(scheduledAndPublished);

    await expect(
      service.updateStatus(
        'bai-da-len-lich',
        ContentStatus.PUBLISHED,
        Role.EDITOR,
      ),
    ).rejects.toThrow();
    expect(prisma.newsPost.update).not.toHaveBeenCalled();
  });
});

/**
 * Cố ý KHÔNG có test "service tự lọc `scheduledAt` khỏi payload".
 *
 * `create`/`update` trải `...rest` thẳng vào Prisma (đúng mẫu chung của cả
 * projects/pages/cooperation), nên một object mang thêm `scheduledAt` vẫn ghi
 * xuống DB. Nhưng để dựng được object đó phải **phá kiểu tường minh**
 * (`as unknown as CreateNewsPostDto`): DTO không còn khai báo field, nên mọi
 * lời gọi thật đều bị TypeScript chặn, và mọi request thật đều bị
 * `forbidNonWhitelisted` chặn thành 400 (khoá ở
 * `dto/news-schedule-write-block.spec.ts`).
 *
 * Thêm một lớp lọc thủ công trong service để chống một kịch bản chỉ tồn tại khi
 * cố tình vô hiệu hoá trình biên dịch là lệch khỏi mẫu chung của codebase mà
 * không đóng thêm được lối vào nào có thật. Ghi lại ở đây để lần sau không ai
 * phải suy luận lại.
 */
