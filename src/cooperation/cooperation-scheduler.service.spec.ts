import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CooperationSchedulerService } from './cooperation-scheduler.service';

/**
 * **Batch 10 — reconciler đăng dự án hợp tác theo lịch.**
 *
 * Reconciler KHÔNG quyết định tính đúng đắn: vị từ hiển thị đã cho một bản ghi
 * tới hạn ra công khai từ trước khi cron kịp chạy. Việc của nó là **chuẩn hoá
 * trạng thái lưu trữ** — và vì nó có quyền đổi `content_status` mà không ai
 * nhìn, câu SQL của nó phải chặt hơn, không lỏng hơn, vị từ hiển thị.
 *
 * Bộ test này kiểm chính CÂU SQL (không phải kết quả giả lập): tập bản ghi mà
 * reconciler được phép đăng phải là **tập con** của tập mà vị từ hiển thị coi là
 * công khai. Vi phạm điều đó là vô hiệu hoá lớp phòng thủ từ phía sau.
 *
 * Các ca dữ liệu thật (PENDING quá khứ/đúng hạn/tương lai, DRAFT quá khứ, …)
 * được kiểm trên PostgreSQL thật — xem báo cáo kiểm chứng của batch; ở đây kiểm
 * hợp đồng SQL để lỗi hiện ra ngay khi ai đó sửa câu lệnh.
 */
describe('CooperationSchedulerService', () => {
  let service: CooperationSchedulerService;
  let queryRaw: jest.Mock;

  beforeEach(async () => {
    queryRaw = jest.fn().mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        CooperationSchedulerService,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();

    service = moduleRef.get(CooperationSchedulerService);
  });

  /** Câu SQL thô đã gửi xuống Prisma, gộp lại thành một chuỗi. */
  function sql(): string {
    const [template] = queryRaw.mock.calls[0] as [TemplateStringsArray];
    return template.join(' ').replace(/\s+/g, ' ');
  }

  describe('điều kiện quét', () => {
    it('chạy đúng trên bảng cooperation_projects', async () => {
      await service.publishDueProjects();
      expect(sql()).toContain('UPDATE "cooperation_projects"');
    });

    /**
     * Chốt bảo mật trung tâm (§30). `<> 'PUBLISHED'` sẽ khớp luôn hàng dị dạng
     * `DRAFT` + lịch quá khứ và **tự tay đăng nó** — sau đó hàng ấy công khai
     * qua nhánh `PUBLISHED` của vị từ hiển thị. Phải là ĐÚNG `PENDING`.
     */
    it('chỉ quét content_status = PENDING (không phải <> PUBLISHED)', async () => {
      await service.publishDueProjects();

      expect(sql()).toContain(
        `WHERE "content_status" = 'PENDING'::"ContentStatus"`,
      );
      expect(sql()).not.toContain('<>');
    });

    it('đòi có lịch và lịch đã tới hạn', async () => {
      await service.publishDueProjects();

      expect(sql()).toContain('"scheduled_at" IS NOT NULL');
      expect(sql()).toContain('"scheduled_at" <=');
    });

    /**
     * **Hồi quy múi giờ — đo được trên PostgreSQL thật, không phải lo xa.**
     *
     * `scheduled_at` là `timestamp WITHOUT time zone` và Prisma ghi giờ **UTC**
     * vào đó. `NOW()` trả `timestamptz`; khi so hai kiểu này, Postgres quy đổi
     * vế `timestamp` theo `TimeZone` của phiên. Trên phiên `Asia/Bangkok`:
     *
     * ```
     * scheduled_at = 2026-08-19 15:29:53   (UTC, còn 1 giờ nữa mới tới hạn)
     * NOW()        = 2026-08-19 21:29:54 +07
     * scheduled_at <= NOW()  →  true   ← reconciler ĐĂNG SỚM 7 GIỜ
     * ```
     *
     * Sai theo hướng tệ nhất: "rò rỉ sớm", đúng thứ mọi vị từ trong batch này
     * được thiết kế để không bao giờ xảy ra. `AT TIME ZONE 'utc'` đưa "bây giờ"
     * về đúng hệ quy chiếu cột đang lưu.
     */
    it('so lịch trong hệ quy chiếu UTC, không phải NOW() trần (múi giờ phiên DB)', async () => {
      await service.publishDueProjects();

      expect(sql()).toContain(`"scheduled_at" <= (NOW() AT TIME ZONE 'utc')`);
      expect(sql()).not.toMatch(/"scheduled_at" <= NOW\(\)/);
    });

    /**
     * `status` của bảng này là JSONB mô tả bằng CHỮ ("Đã bàn giao"). Nó không
     * bao giờ được xuất hiện trong một vị từ xuất bản — kể cả tình cờ.
     */
    it('KHÔNG dùng cột `status` (chữ mô tả) ở bất kỳ đâu', async () => {
      await service.publishDueProjects();

      expect(sql()).not.toMatch(/"status"/);
    });
  });

  describe('chuẩn hoá (§29)', () => {
    it('đặt PUBLISHED và xoá lịch treo', async () => {
      await service.publishDueProjects();

      expect(sql()).toContain(
        `SET "content_status" = 'PUBLISHED'::"ContentStatus"`,
      );
      expect(sql()).toContain('"scheduled_at" = NULL');
    });

    /**
     * `COALESCE` giữ đúng **giờ đã hẹn**, không phải giờ cron tình cờ chạy. Nếu
     * chỗ này thành `NOW()` thì `published_at` mất nghĩa "lần công khai đầu
     * tiên" — và mất theo cách không ai để ý, vì hai giá trị chỉ lệch nhau vài
     * phút.
     */
    it('published_at = COALESCE(published_at, scheduled_at) — KHÔNG phải NOW()', async () => {
      await service.publishDueProjects();

      expect(sql()).toContain(
        '"published_at" = COALESCE("published_at", "scheduled_at")',
      );
      expect(sql()).not.toContain('"published_at" = NOW()');
    });

    it('trả về id của các bản vừa đăng (model này không có slug)', async () => {
      await service.publishDueProjects();

      expect(sql()).toContain('RETURNING "id"');
    });
  });

  describe('tính idempotent (§31)', () => {
    /**
     * Hai lớp chặn ĐỘC LẬP: sau lượt đầu bản ghi đã là PUBLISHED (không còn khớp
     * `= 'PENDING'`) và `scheduled_at` đã NULL (không còn khớp `IS NOT NULL`).
     * Mất một lớp thì lớp kia vẫn giữ.
     */
    it('câu lệnh tự loại chính bản ghi nó vừa đăng', async () => {
      await service.publishDueProjects();

      expect(sql()).toContain(
        `WHERE "content_status" = 'PENDING'::"ContentStatus"`,
      );
      expect(sql()).toContain('"scheduled_at" IS NOT NULL');
    });

    it('lượt hai không đăng thêm gì khi không còn bản tới hạn', async () => {
      queryRaw.mockResolvedValueOnce([{ id: 'c1' }]).mockResolvedValueOnce([]);

      await expect(service.publishDueProjects()).resolves.toHaveLength(1);
      await expect(service.publishDueProjects()).resolves.toHaveLength(0);
    });
  });

  describe('cron (§32)', () => {
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

    /**
     * Cron KHÔNG được ném lỗi ra ngoài: Nest sẽ nhận unhandled rejection và
     * tiến trình có thể chết. Lượt sau vẫn quét lại đúng các bản chưa đăng.
     */
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
