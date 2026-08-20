import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { PagesSchedulerService } from './pages-scheduler.service';

/**
 * **Batch 11 — reconciler đăng trang theo lịch.**
 *
 * Reconciler KHÔNG quyết định tính đúng đắn: vị từ hiển thị đã cho một trang tới
 * hạn ra công khai từ trước khi cron kịp chạy. Việc của nó là **chuẩn hoá trạng
 * thái lưu trữ** — và vì nó có quyền đổi `status` mà không ai nhìn, câu SQL của
 * nó phải chặt hơn, không lỏng hơn, vị từ hiển thị.
 *
 * Các ca dữ liệu thật (PENDING quá khứ/đúng hạn/tương lai, DRAFT quá khứ, …)
 * được kiểm trên PostgreSQL thật ở `test/scheduler-utc.e2e-spec.ts`; ở đây kiểm
 * hợp đồng SQL để lỗi hiện ra ngay khi ai đó sửa câu lệnh.
 */
describe('PagesSchedulerService', () => {
  let service: PagesSchedulerService;
  let queryRaw: jest.Mock;

  beforeEach(async () => {
    queryRaw = jest.fn().mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PagesSchedulerService,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();

    service = moduleRef.get(PagesSchedulerService);
  });

  /** Câu SQL thô đã gửi xuống Prisma, gộp lại thành một chuỗi. */
  function sql(): string {
    const [template] = queryRaw.mock.calls[0] as [TemplateStringsArray];
    return template.join(' ').replace(/\s+/g, ' ');
  }

  describe('điều kiện quét', () => {
    it('chạy đúng trên bảng pages', async () => {
      await service.publishDuePages();
      expect(sql()).toContain('UPDATE "pages"');
    });

    /**
     * Chốt bảo mật trung tâm (§28). `<> 'PUBLISHED'` sẽ khớp luôn hàng dị dạng
     * `DRAFT` + lịch quá khứ và **tự tay đăng nó**. Phải là ĐÚNG `PENDING`.
     */
    it("chỉ quét status = 'PENDING' (không phải <> 'PUBLISHED')", async () => {
      await service.publishDuePages();

      expect(sql()).toContain(`WHERE "status" = 'PENDING'::"ContentStatus"`);
      expect(sql()).not.toContain('<>');
    });

    it('đòi có lịch và lịch đã tới hạn', async () => {
      await service.publishDuePages();

      expect(sql()).toContain('"scheduled_at" IS NOT NULL');
      expect(sql()).toContain('"scheduled_at" <=');
    });

    /**
     * **Hồi quy múi giờ (§32).** `scheduled_at` là `timestamp WITHOUT time zone`
     * chứa giờ UTC; `NOW()` là `timestamptz`. So hai kiểu này khiến Postgres quy
     * đổi vế `timestamp` theo `TimeZone` của phiên — trên `Asia/Bangkok` trang
     * ra công khai SỚM 7 giờ. Đây là lỗi đã đo được ở Batch 10 và đã vá cho
     * News/Project/Cooperation; Page phải thừa hưởng ngay từ đầu.
     */
    it('so lịch trong hệ quy chiếu UTC, không phải NOW() trần', async () => {
      await service.publishDuePages();

      expect(sql()).toContain(`"scheduled_at" <= (NOW() AT TIME ZONE 'utc')`);
      expect(sql()).not.toMatch(/"scheduled_at" <= NOW\(\)/);
    });
  });

  describe('chuẩn hoá (§27)', () => {
    it('đặt PUBLISHED và xoá lịch treo', async () => {
      await service.publishDuePages();

      expect(sql()).toContain(`SET "status" = 'PUBLISHED'::"ContentStatus"`);
      expect(sql()).toContain('"scheduled_at" = NULL');
    });

    /**
     * `COALESCE` giữ đúng **giờ đã hẹn**, không phải giờ cron tình cờ chạy. Nếu
     * chỗ này thành `NOW()` thì `published_at` mất nghĩa "lần công khai đầu
     * tiên" — và mất theo cách không ai để ý, vì hai giá trị chỉ lệch vài phút.
     */
    it('published_at = COALESCE(published_at, scheduled_at) — KHÔNG phải NOW()', async () => {
      await service.publishDuePages();

      expect(sql()).toContain(
        '"published_at" = COALESCE("published_at", "scheduled_at")',
      );
      expect(sql()).not.toContain('"published_at" = NOW()');
    });

    /** §32: phép GÁN cũng phải ở hệ quy chiếu UTC, không chỉ phép SO. */
    it("updated_at ghi bằng (NOW() AT TIME ZONE 'utc')", async () => {
      await service.publishDuePages();

      expect(sql()).toContain(`"updated_at" = (NOW() AT TIME ZONE 'utc')`);
      expect(sql()).not.toMatch(/"updated_at" = NOW\(\)/);
    });

    it('trả về id + slug của các trang vừa đăng', async () => {
      await service.publishDuePages();

      expect(sql()).toContain('RETURNING "id", "slug"');
    });
  });

  describe('tính idempotent (§29)', () => {
    /**
     * Hai lớp chặn ĐỘC LẬP: sau lượt đầu bản ghi đã là PUBLISHED (không còn khớp
     * `= 'PENDING'`) và `scheduled_at` đã NULL (không còn khớp `IS NOT NULL`).
     */
    it('câu lệnh tự loại chính bản ghi nó vừa đăng', async () => {
      await service.publishDuePages();

      expect(sql()).toContain(`WHERE "status" = 'PENDING'::"ContentStatus"`);
      expect(sql()).toContain('"scheduled_at" IS NOT NULL');
    });

    it('lượt hai không đăng thêm gì khi không còn trang tới hạn', async () => {
      queryRaw
        .mockResolvedValueOnce([{ id: 'g1', slug: 'gioi-thieu' }])
        .mockResolvedValueOnce([]);

      await expect(service.publishDuePages()).resolves.toHaveLength(1);
      await expect(service.publishDuePages()).resolves.toHaveLength(0);
    });
  });

  describe('cron (§30)', () => {
    it('bỏ qua lượt mới khi lượt trước chưa xong', async () => {
      let release!: (rows: unknown[]) => void;
      queryRaw.mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      );

      const first = service.handleCron();
      await service.handleCron();
      expect(queryRaw).toHaveBeenCalledTimes(1);

      release([]);
      await first;
    });

    it('nuốt lỗi DB và không làm sập tiến trình', async () => {
      queryRaw.mockRejectedValueOnce(new Error('DB sập'));

      await expect(service.handleCron()).resolves.toBeUndefined();
    });

    it('mở khoá sau khi lỗi — lượt kế tiếp vẫn chạy', async () => {
      queryRaw.mockRejectedValueOnce(new Error('DB sập'));

      await service.handleCron();
      await service.handleCron();

      expect(queryRaw).toHaveBeenCalledTimes(2);
    });
  });
});
