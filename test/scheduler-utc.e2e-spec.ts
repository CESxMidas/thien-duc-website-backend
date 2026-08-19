import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { NewsSchedulerService } from '../src/news/news-scheduler.service';
import { ProjectsSchedulerService } from '../src/projects/projects-scheduler.service';
import { CooperationSchedulerService } from '../src/cooperation/cooperation-scheduler.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * **Hồi quy múi giờ của reconciler — chạy trên PostgreSQL THẬT.**
 *
 * Lỗi được phát hiện khi kiểm chứng Batch 10: `scheduled_at` là
 * `timestamp WITHOUT time zone` và Prisma ghi **giờ UTC** vào đó, còn `NOW()`
 * trả `timestamptz`. Khi so hai kiểu này, Postgres quy đổi vế `timestamp` theo
 * `TimeZone` của **phiên**, nên trên DB không chạy UTC thì
 *
 * ```
 * scheduled_at <= NOW()
 * ```
 *
 * cho `true` sớm đúng bằng offset múi giờ — nội dung tự ra công khai trước giờ
 * hẹn tới 7 tiếng trên `Asia/Bangkok`. Sai theo hướng tệ nhất: "rò rỉ sớm".
 *
 * Bộ test này KHÔNG soi chuỗi SQL (đã có test đơn vị làm việc đó). Nó ép phiên
 * sang `Asia/Bangkok` rồi gọi **chính phương thức reconciler thật** và kiểm hành
 * vi — nên nó sẽ ĐỎ nếu ai đó đưa `NOW()` trần trở lại, và sẽ xanh trên cả DB
 * chạy UTC lẫn DB chạy múi giờ khác.
 *
 * An toàn: chỉ chạy trên `thien_duc_test` (tự kiểm định danh trước khi ghi), mọi
 * fixture nằm trong transaction và luôn ROLLBACK — không để lại một hàng nào.
 */

const TZ = 'Asia/Bangkok';
const HOUR_MS = 3_600_000;
/**
 * Ném ra để buộc Prisma cuộn ngược transaction sau khi đã kiểm xong. Dùng lớp
 * lỗi riêng thay vì một Symbol để phân biệt chắc chắn với lỗi thật.
 */
class RollbackSignal extends Error {
  constructor() {
    super('rollback fixtures');
    this.name = 'RollbackSignal';
  }
}

/** Chỉ cần `$queryRaw` để chạy đúng câu SQL của reconciler trong transaction. */
type RawClient = Pick<PrismaClient, '$queryRaw'>;
const asPrismaService = (client: RawClient) =>
  client as unknown as PrismaService;

const vi = (text: string) => ({ vi: text });

describe('Reconciler đăng theo lịch — hồi quy múi giờ (PostgreSQL thật)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });

    // Cầu chì: tuyệt đối không ghi nhầm DB. Kiểm TRƯỚC mọi fixture.
    const [meta] = await prisma.$queryRaw<
      { db: string; port: number }[]
    >`SELECT current_database() AS db, inet_server_port() AS port`;
    if (meta.db !== 'thien_duc_test' || Number(meta.port) !== 5432) {
      throw new Error(
        `Sai database: ${meta.db}:${meta.port} — chỉ chạy trên thien_duc_test:5432.`,
      );
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * Chạy `body` trong một transaction có `TimeZone = Asia/Bangkok`, rồi ROLLBACK.
   *
   * Mốc "bây giờ" lấy từ ĐỒNG HỒ DB (giờ bắt đầu transaction): trong transaction
   * `NOW()` đứng yên, nên một mốc lấy từ Node vài mili-giây sau sẽ nằm ở tương
   * lai so với reconciler và ca "đúng giây đáo hạn" sẽ không bao giờ khớp.
   */
  async function inBangkokTx<T>(
    body: (tx: RawClient & PrismaClient, now: Date) => Promise<T>,
  ): Promise<T> {
    let captured!: T;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${TZ}'`);
        const [session] = await tx.$queryRaw<
          { tz: string }[]
        >`SELECT current_setting('TimeZone') AS tz`;
        expect(session.tz).toBe(TZ);

        const [clock] = await tx.$queryRaw<
          { now: Date }[]
        >`SELECT (NOW() AT TIME ZONE 'utc') AS now`;

        captured = await body(tx as RawClient & PrismaClient, clock.now);
        throw new RollbackSignal();
      });
    } catch (error) {
      if (!(error instanceof RollbackSignal)) throw error;
    }
    return captured;
  }

  describe('Tin tức', () => {
    it('không đăng sớm bản hẹn tương lai, đăng đúng bản tới hạn, bỏ qua dị dạng', async () => {
      const seen = await inBangkokTx(async (tx, now) => {
        const category = await tx.newsCategory.create({
          data: { slug: 'tz-cat', name: vi('TZ'), order: 99 },
        });
        const base = {
          categoryId: category.id,
          summary: vi('x'),
          content: [vi('x')],
        };
        const mk = (
          slug: string,
          status: 'DRAFT' | 'PENDING' | 'PUBLISHED',
          scheduledAt: Date | null,
          publishedAt: Date | null,
        ) =>
          tx.newsPost.create({
            data: {
              ...base,
              slug,
              title: vi(slug),
              status,
              scheduledAt,
              publishedAt,
            },
          });

        const future = new Date(now.getTime() + HOUR_MS);
        const past = new Date(now.getTime() - HOUR_MS);

        await mk('tz-future', 'PENDING', future, future);
        await mk('tz-due', 'PENDING', past, past);
        await mk('tz-draft-past', 'DRAFT', past, null);
        await mk('tz-pending-nosched', 'PENDING', null, null);
        await mk('tz-published', 'PUBLISHED', null, past);

        const service = new NewsSchedulerService(asPrismaService(tx));

        const first = await service.publishDuePosts();
        const second = await service.publishDuePosts();

        const rows = await tx.newsPost.findMany({
          where: { slug: { startsWith: 'tz-' } },
          select: {
            slug: true,
            status: true,
            scheduledAt: true,
            publishedAt: true,
          },
        });

        return {
          firstSlugs: first.map((p) => p.slug).sort(),
          secondCount: second.length,
          byslug: Object.fromEntries(rows.map((r) => [r.slug, r])),
          due: past,
        };
      });

      // A + B: chỉ bản TỚI HẠN được đăng; bản hẹn tương lai không bị chạm.
      expect(seen.firstSlugs).toEqual(['tz-due']);
      expect(seen.byslug['tz-future'].status).toBe('PENDING');
      expect(seen.byslug['tz-future'].scheduledAt).not.toBeNull();

      // B: bản tới hạn chuẩn hoá đúng, GIỮ mốc công khai theo giờ đã hẹn.
      expect(seen.byslug['tz-due'].status).toBe('PUBLISHED');
      expect(seen.byslug['tz-due'].scheduledAt).toBeNull();
      expect(seen.byslug['tz-due'].publishedAt).toEqual(seen.due);

      // C: dị dạng DRAFT + lịch quá khứ KHÔNG bao giờ được chuẩn hoá.
      expect(seen.byslug['tz-draft-past'].status).toBe('DRAFT');
      expect(seen.byslug['tz-draft-past'].scheduledAt).not.toBeNull();

      // D + E: không lịch và đã đăng đều bị bỏ qua.
      expect(seen.byslug['tz-pending-nosched'].status).toBe('PENDING');
      expect(seen.byslug['tz-published'].status).toBe('PUBLISHED');

      // Lượt hai không đăng thêm gì.
      expect(seen.secondCount).toBe(0);
    });
  });

  describe('Dự án', () => {
    it('không đăng sớm bản hẹn tương lai, đăng đúng bản tới hạn, bỏ qua dị dạng', async () => {
      const seen = await inBangkokTx(async (tx, now) => {
        const mk = (
          slug: string,
          contentStatus: 'DRAFT' | 'PENDING' | 'PUBLISHED',
          scheduledAt: Date | null,
          publishedAt: Date | null,
        ) =>
          tx.project.create({
            data: {
              slug,
              title: vi(slug),
              summary: vi('x'),
              status: 'DA_BAN_GIAO',
              contentStatus,
              scheduledAt,
              publishedAt,
              order: 0,
            },
          });

        const future = new Date(now.getTime() + HOUR_MS);
        const past = new Date(now.getTime() - HOUR_MS);

        await mk('tz-future', 'PENDING', future, future);
        await mk('tz-due', 'PENDING', past, past);
        await mk('tz-draft-past', 'DRAFT', past, null);
        await mk('tz-pending-nosched', 'PENDING', null, null);
        await mk('tz-published', 'PUBLISHED', null, past);

        const service = new ProjectsSchedulerService(asPrismaService(tx));

        const first = await service.publishDueProjects();
        const second = await service.publishDueProjects();

        const rows = await tx.project.findMany({
          where: { slug: { startsWith: 'tz-' } },
          select: {
            slug: true,
            contentStatus: true,
            scheduledAt: true,
            publishedAt: true,
          },
        });

        return {
          firstSlugs: first.map((p) => p.slug).sort(),
          secondCount: second.length,
          byslug: Object.fromEntries(rows.map((r) => [r.slug, r])),
          due: past,
        };
      });

      expect(seen.firstSlugs).toEqual(['tz-due']);
      expect(seen.byslug['tz-future'].contentStatus).toBe('PENDING');
      expect(seen.byslug['tz-future'].scheduledAt).not.toBeNull();

      expect(seen.byslug['tz-due'].contentStatus).toBe('PUBLISHED');
      expect(seen.byslug['tz-due'].scheduledAt).toBeNull();
      expect(seen.byslug['tz-due'].publishedAt).toEqual(seen.due);

      expect(seen.byslug['tz-draft-past'].contentStatus).toBe('DRAFT');
      expect(seen.byslug['tz-pending-nosched'].contentStatus).toBe('PENDING');
      expect(seen.byslug['tz-published'].contentStatus).toBe('PUBLISHED');

      expect(seen.secondCount).toBe(0);
    });
  });

  describe('Dự án hợp tác', () => {
    it('không đăng sớm bản hẹn tương lai, đăng đúng bản tới hạn, bỏ qua dị dạng', async () => {
      const seen = await inBangkokTx(async (tx, now) => {
        const mk = (
          name: string,
          contentStatus: 'DRAFT' | 'PENDING' | 'PUBLISHED',
          scheduledAt: Date | null,
          publishedAt: Date | null,
        ) =>
          tx.cooperationProject.create({
            data: {
              name: vi(name),
              location: vi('x'),
              role: vi('x'),
              partner: vi('x'),
              scale: vi('x'),
              // Trạng thái mô tả bằng CHỮ — không phải bậc thang duyệt.
              status: vi('Đã bàn giao'),
              contentStatus,
              scheduledAt,
              publishedAt,
              order: 0,
            },
          });

        const future = new Date(now.getTime() + HOUR_MS);
        const past = new Date(now.getTime() - HOUR_MS);

        const rowFuture = await mk('tz-future', 'PENDING', future, future);
        const rowDue = await mk('tz-due', 'PENDING', past, past);
        const rowDraftPast = await mk('tz-draft-past', 'DRAFT', past, null);

        const service = new CooperationSchedulerService(asPrismaService(tx));

        const first = await service.publishDueProjects();
        const second = await service.publishDueProjects();

        const load = (id: string) =>
          tx.cooperationProject.findUniqueOrThrow({ where: { id } });

        return {
          firstIds: first.map((r) => r.id),
          secondCount: second.length,
          future: await load(rowFuture.id),
          due: await load(rowDue.id),
          draftPast: await load(rowDraftPast.id),
          dueInstant: past,
          dueId: rowDue.id,
        };
      });

      expect(seen.firstIds).toEqual([seen.dueId]);

      expect(seen.future.contentStatus).toBe('PENDING');
      expect(seen.future.scheduledAt).not.toBeNull();

      expect(seen.due.contentStatus).toBe('PUBLISHED');
      expect(seen.due.scheduledAt).toBeNull();
      expect(seen.due.publishedAt).toEqual(seen.dueInstant);
      // Nội dung biên tập không bị reconciler chạm tới.
      expect(seen.due.status).toEqual({ vi: 'Đã bàn giao' });

      expect(seen.draftPast.contentStatus).toBe('DRAFT');
      expect(seen.draftPast.scheduledAt).not.toBeNull();

      expect(seen.secondCount).toBe(0);
    });
  });
});
