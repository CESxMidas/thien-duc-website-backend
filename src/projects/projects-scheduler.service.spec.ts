import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsSchedulerService } from './projects-scheduler.service';

/**
 * **Batch 9 — reconciler đăng dự án theo lịch.**
 *
 * Reconciler KHÔNG quyết định tính đúng đắn: vị từ hiển thị đã cho một dự án tới
 * hạn ra công khai từ trước khi cron kịp chạy. Việc của nó là **chuẩn hoá trạng
 * thái lưu trữ** — và vì nó có quyền đổi `content_status` mà không ai nhìn, câu
 * SQL của nó phải chặt hơn, không lỏng hơn, vị từ hiển thị.
 *
 * Bộ test này kiểm chính CÂU SQL (không phải kết quả giả lập): tập bản ghi mà
 * reconciler được phép đăng phải là **tập con** của tập mà vị từ hiển thị coi là
 * công khai. Vi phạm điều đó là vô hiệu hoá lớp phòng thủ từ phía sau.
 */
describe('ProjectsSchedulerService', () => {
  let service: ProjectsSchedulerService;
  let queryRaw: jest.Mock;

  beforeEach(async () => {
    queryRaw = jest.fn().mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsSchedulerService,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();

    service = moduleRef.get(ProjectsSchedulerService);
  });

  /** Câu SQL thô đã gửi xuống Prisma, gộp lại thành một chuỗi. */
  function sql(): string {
    const [template] = queryRaw.mock.calls[0] as [TemplateStringsArray];
    return template.join(' ').replace(/\s+/g, ' ');
  }

  describe('điều kiện quét', () => {
    it('chạy đúng trên bảng projects', async () => {
      await service.publishDueProjects();
      expect(sql()).toContain('UPDATE "projects"');
    });

    /**
     * Chốt bảo mật trung tâm. `<> 'PUBLISHED'` sẽ khớp luôn hàng dị dạng
     * `DRAFT` + lịch quá khứ và **tự tay đăng nó** — sau đó hàng ấy công khai
     * qua nhánh `PUBLISHED` của vị từ hiển thị. Phải là ĐÚNG `PENDING`.
     */
    it('chỉ quét PENDING, KHÔNG dùng `<> PUBLISHED`', async () => {
      await service.publishDueProjects();

      expect(sql()).toContain(`"content_status" = 'PENDING'::"ContentStatus"`);
      expect(sql()).not.toContain('<>');
      expect(sql()).not.toContain('!=');
    });

    it('đòi lịch tồn tại VÀ đã tới hạn theo đồng hồ của DB', async () => {
      await service.publishDueProjects();

      expect(sql()).toContain('"scheduled_at" IS NOT NULL');
      expect(sql()).toContain('"scheduled_at" <= NOW()');
    });
  });

  describe('chuẩn hoá trạng thái', () => {
    it('đặt PUBLISHED và xoá lịch treo', async () => {
      await service.publishDueProjects();

      expect(sql()).toContain(
        `"content_status" = 'PUBLISHED'::"ContentStatus"`,
      );
      expect(sql()).toContain('"scheduled_at" = NULL');
    });

    /**
     * `published_at` phải giữ **giờ đã hẹn**, không phải giờ cron tình cờ chạy.
     * Lệnh đặt lịch đã ghi sẵn `published_at = scheduled_at`, nên `COALESCE`
     * giữ nguyên mốc đó; nhánh `scheduled_at` chỉ đỡ cho dữ liệu dị dạng.
     *
     * Nếu chỗ này là `NOW()` thì một dự án hẹn 08:00 mà backend ngủ tới 10:30 sẽ
     * mang mốc công khai 10:30 — sai lịch sử, sai cả `lastModified` của sitemap.
     */
    it('giữ mốc công khai đã hẹn (COALESCE), KHÔNG dùng giờ cron', async () => {
      await service.publishDueProjects();

      expect(sql()).toContain(
        '"published_at" = COALESCE("published_at", "scheduled_at")',
      );
      expect(sql()).not.toContain('"published_at" = NOW()');
    });

    it('trả về id + slug của các dự án vừa đăng', async () => {
      queryRaw.mockResolvedValue([{ id: 'p1', slug: 'du-an' }]);

      await expect(service.publishDueProjects()).resolves.toEqual([
        { id: 'p1', slug: 'du-an' },
      ]);
      expect(sql()).toContain('RETURNING "id", "slug"');
    });
  });

  /**
   * §29 — idempotent nhờ HAI lớp chặn độc lập, cả hai nằm ngay trong `WHERE`:
   * sau lượt đầu bản ghi không còn `PENDING`, và `scheduled_at` cũng đã NULL.
   * Lượt thứ hai vì thế không khớp hàng nào.
   */
  describe('chạy lại nhiều lần', () => {
    it('lượt thứ hai không đăng gì thêm', async () => {
      queryRaw.mockResolvedValueOnce([{ id: 'p1', slug: 'du-an' }]);
      queryRaw.mockResolvedValueOnce([]);

      await expect(service.publishDueProjects()).resolves.toHaveLength(1);
      await expect(service.publishDueProjects()).resolves.toHaveLength(0);
    });

    it('hai lớp chặn cùng nằm trong điều kiện quét', async () => {
      await service.publishDueProjects();

      // Lớp 1: trạng thái không còn PENDING sau lượt đầu.
      expect(sql()).toContain(`"content_status" = 'PENDING'`);
      // Lớp 2: lịch đã bị xoá nên `IS NOT NULL` không còn khớp.
      expect(sql()).toContain('"scheduled_at" IS NOT NULL');
      expect(sql()).toContain('"scheduled_at" = NULL');
    });
  });

  describe('cron', () => {
    it('bỏ qua lượt mới khi lượt trước chưa xong', async () => {
      let release: (() => void) | undefined;
      queryRaw.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve([]);
          }),
      );

      const first = service.handleCron();
      await service.handleCron(); // chồng lượt — phải không gọi SQL lần hai
      release?.();
      await first;

      expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    /**
     * Cron KHÔNG được ném lỗi ra ngoài: Nest sẽ nhận unhandled rejection và
     * tiến trình có thể chết. Lượt sau vẫn quét lại đúng các dự án chưa đăng.
     */
    it('nuốt lỗi để tiến trình không chết', async () => {
      queryRaw.mockRejectedValueOnce(new Error('DB sập'));

      await expect(service.handleCron()).resolves.toBeUndefined();
    });

    it('sau một lượt lỗi vẫn chạy được lượt kế tiếp', async () => {
      queryRaw.mockRejectedValueOnce(new Error('DB sập'));
      await service.handleCron();

      await service.handleCron();

      expect(queryRaw).toHaveBeenCalledTimes(2);
    });
  });
});
