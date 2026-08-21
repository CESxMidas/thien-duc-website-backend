import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { BannersService } from '../src/banners/banners.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * **Cửa sổ hiển thị banner — chạy trên PostgreSQL THẬT.**
 *
 * Vì sao không đủ nếu chỉ có test đơn vị: test đơn vị khoá được `where` mà
 * service dựng ra, nhưng KHÔNG trả lời được câu hỏi quan trọng nhất — Postgres
 * thật sự trả về những hàng nào. Ba thứ chỉ lộ ra trên DB thật:
 *
 *  1. Nhánh `OR: [{ field: null }, ...]` của Prisma có dịch thành `IS NULL` như
 *     mong đợi không (nếu không, mọi banner không đặt biên sẽ biến mất khỏi
 *     trang chủ — hồi quy tệ nhất có thể của batch này).
 *  2. Hành vi tại ĐÚNG BIÊN, với độ chính xác `timestamp(3)` của cột.
 *  3. Múi giờ. `display_from`/`display_until` là `timestamp WITHOUT time zone`
 *     chứa giờ UTC. Lỗi đã gặp ở Batch 10 (xem `scheduler-utc.e2e-spec.ts`) là
 *     so cột đó với `NOW()` kiểu `timestamptz`, khiến nội dung ra sớm đúng bằng
 *     offset phiên. Vị từ của banner cố ý so với một `Date` của JS đi qua bind
 *     parameter, nên phải chứng minh nó miễn nhiễm: cả bộ này chạy trong phiên
 *     `Asia/Bangkok`.
 *
 * An toàn: chỉ chạy trên `thien_duc_test` (tự kiểm định danh trước khi ghi), mọi
 * fixture nằm trong transaction và luôn ROLLBACK — không để lại một hàng nào.
 */

const TZ = 'Asia/Bangkok';
const HOUR_MS = 3_600_000;

/** Ném ra để buộc Prisma cuộn ngược transaction sau khi đã kiểm xong. */
class RollbackSignal extends Error {
  constructor() {
    super('rollback fixtures');
    this.name = 'RollbackSignal';
  }
}

const asPrismaService = (client: unknown) => client as PrismaService;

const vi = (text: string) => ({ vi: text });

/** Sáu ca của §50, mỗi ca một hàng — tên hàng chính là điều nó khẳng định. */
interface Fixture {
  key: string;
  isActive: boolean;
  /** Lệch so với `now` tính bằng mili giây; `null` = không đặt biên. */
  fromOffsetMs: number | null;
  untilOffsetMs: number | null;
  order: number;
}

const FIXTURES: Fixture[] = [
  // A. đang bật, không cửa sổ — hành vi trước Batch 12, phải giữ nguyên.
  {
    key: 'a-always',
    isActive: true,
    fromOffsetMs: null,
    untilOffsetMs: null,
    order: 0,
  },
  // B. đang bật, bắt đầu ở tương lai — chưa được hiện.
  {
    key: 'b-upcoming',
    isActive: true,
    fromOffsetMs: HOUR_MS,
    untilOffsetMs: null,
    order: 1,
  },
  // C. đang bật, đã bắt đầu, kết thúc ở tương lai — đang hiện.
  {
    key: 'c-open-ended',
    isActive: true,
    fromOffsetMs: -HOUR_MS,
    untilOffsetMs: HOUR_MS,
    order: 2,
  },
  // D. đang bật, đã hết hạn — không hiện nữa, không cần ai đổi trạng thái.
  {
    key: 'd-expired',
    isActive: true,
    fromOffsetMs: -2 * HOUR_MS,
    untilOffsetMs: -HOUR_MS,
    order: 3,
  },
  // E. ĐANG TẮT nhưng cửa sổ hợp lệ — công tắc thủ công vẫn phủ quyết.
  {
    key: 'e-inactive-in-window',
    isActive: false,
    fromOffsetMs: -HOUR_MS,
    untilOffsetMs: HOUR_MS,
    order: 4,
  },
  // F. đang bật, chỉ có biên trên còn hiệu lực — hiện.
  {
    key: 'f-until-only',
    isActive: true,
    fromOffsetMs: null,
    untilOffsetMs: HOUR_MS,
    order: 5,
  },
  // G. đang tắt, không cửa sổ — vẫn ẩn như trước Batch 12.
  {
    key: 'g-inactive-always',
    isActive: false,
    fromOffsetMs: null,
    untilOffsetMs: null,
    order: 6,
  },
  // H. dị dạng do sửa tay: from > until. Không bao giờ được hiện.
  {
    key: 'h-malformed',
    isActive: true,
    fromOffsetMs: HOUR_MS,
    untilOffsetMs: -HOUR_MS,
    order: 7,
  },
];

describe('Cửa sổ hiển thị banner — truy vấn công khai (PostgreSQL thật)', () => {
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
   * Mốc "bây giờ" lấy từ ĐỒNG HỒ DB (đứng yên suốt transaction) để ca "đúng tại
   * biên" dựng được chính xác: fixture và vị từ phải dùng chung một mốc.
   */
  async function inBangkokTx<T>(
    body: (tx: PrismaClient, now: Date) => Promise<T>,
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

        captured = await body(tx as PrismaClient, clock.now);
        throw new RollbackSignal();
      });
    } catch (error) {
      if (!(error instanceof RollbackSignal)) throw error;
    }
    return captured;
  }

  /** Tạo một banner; `href` giữ tiền tố `/du-an` cho khớp ràng buộc DTO. */
  function seed(tx: PrismaClient, fixture: Fixture, now: Date) {
    const shift = (offset: number | null) =>
      offset === null ? null : new Date(now.getTime() + offset);
    return tx.banner.create({
      data: {
        image: `/images/banners/home/${fixture.key}.jpg`,
        title: vi(fixture.key),
        href: '/du-an',
        order: fixture.order,
        isActive: fixture.isActive,
        displayFrom: shift(fixture.fromOffsetMs),
        displayUntil: shift(fixture.untilOffsetMs),
      },
    });
  }

  /** Tiêu đề của các banner công khai, theo đúng thứ tự service trả về. */
  async function visibleKeys(tx: PrismaClient, now: Date): Promise<string[]> {
    const service = new BannersService(asPrismaService(tx));
    const rows = await service.findAll(true, now);
    return rows.map((row) => (row.title as { vi: string }).vi);
  }

  it('trả đúng tập banner đủ điều kiện, giữ nguyên thứ tự order', async () => {
    const seen = await inBangkokTx(async (tx, now) => {
      // Sạch bảng TRONG transaction (sẽ rollback) để tập trả về là tất định dù
      // DB test có sẵn banner seed hay không.
      await tx.banner.deleteMany({});
      for (const fixture of FIXTURES) await seed(tx, fixture, now);

      const service = new BannersService(asPrismaService(tx));
      return {
        publicKeys: await visibleKeys(tx, now),
        adminCount: (await service.findAll(false, now)).length,
      };
    });

    // A, C, F hiện. B chưa tới hạn, D hết hạn, E+G đang tắt, H dị dạng.
    expect(seen.publicKeys).toEqual([
      'a-always',
      'c-open-ended',
      'f-until-only',
    ]);
    // Thứ tự tương đối y hệt lúc chưa lọc: 0 < 2 < 5.
    expect(seen.publicKeys).toEqual([...seen.publicKeys].sort());
    // Admin thấy đủ tám hàng — cửa sổ không giấu banner khỏi CMS.
    expect(seen.adminCount).toBe(FIXTURES.length);
  });

  it('banner đang TẮT nằm giữa cửa sổ hợp lệ: vẫn ẩn', async () => {
    const seen = await inBangkokTx(async (tx, now) => {
      await tx.banner.deleteMany({});
      await seed(
        tx,
        FIXTURES.find((f) => f.key === 'e-inactive-in-window')!,
        now,
      );
      return visibleKeys(tx, now);
    });
    expect(seen).toEqual([]);
  });

  it('cửa sổ đảo ngược trong DB: không hiện ở bất kỳ mốc nào', async () => {
    const seen = await inBangkokTx(async (tx, now) => {
      await tx.banner.deleteMany({});
      await seed(
        tx,
        FIXTURES.find((f) => f.key === 'h-malformed')!,
        now,
      );
      const probes = [-3, -1, 0, 1, 3].map((h) =>
        visibleKeys(tx, new Date(now.getTime() + h * HOUR_MS)),
      );
      return (await Promise.all(probes)).flat();
    });
    expect(seen).toEqual([]);
  });

  /**
   * §21 — biên chính xác tới mili giây, đo trên chính kiểu `timestamp(3)` của
   * cột. Một banner duy nhất, cửa sổ `[now, now + 1h)`, dò ở năm mốc.
   */
  it('khoảng nửa mở: hiện đúng tại displayFrom, tắt đúng tại displayUntil', async () => {
    const seen = await inBangkokTx(async (tx, now) => {
      await tx.banner.deleteMany({});
      const until = new Date(now.getTime() + HOUR_MS);
      await tx.banner.create({
        data: {
          image: '/images/banners/home/edge.jpg',
          title: vi('edge'),
          href: '/du-an',
          isActive: true,
          displayFrom: now,
          displayUntil: until,
        },
      });

      const probe = async (offsetMs: number) =>
        (await visibleKeys(tx, new Date(now.getTime() + offsetMs))).length;

      return {
        beforeStart: await probe(-1),
        atStart: await probe(0),
        inside: await probe(HOUR_MS / 2),
        beforeEnd: await probe(HOUR_MS - 1),
        atEnd: await probe(HOUR_MS),
        afterEnd: await probe(HOUR_MS + 1),
      };
    });

    expect(seen.beforeStart).toBe(0);
    expect(seen.atStart).toBe(1); // ĐÚNG mốc bắt đầu → hiện
    expect(seen.inside).toBe(1);
    expect(seen.beforeEnd).toBe(1);
    expect(seen.atEnd).toBe(0); // ĐÚNG mốc kết thúc → tắt
    expect(seen.afterEnd).toBe(0);
  });

  /**
   * §51 — hồi quy múi giờ. Phiên chạy `Asia/Bangkok` (UTC+7). Nếu vị từ lỡ so
   * cột `timestamp` với một giá trị `timestamptz` thì banner hẹn 3 tiếng nữa sẽ
   * hiện SỚM, và banner hết hạn 3 tiếng trước sẽ còn hiện MUỘN — cả hai lệch
   * đúng bằng 7 tiếng. Biên độ 3 tiếng nằm gọn trong offset đó nên bẫy chắc chắn
   * sập nếu lỗi quay lại.
   */
  it('phiên Asia/Bangkok: không hiện sớm, không còn sót lại sau hạn', async () => {
    const seen = await inBangkokTx(async (tx, now) => {
      await tx.banner.deleteMany({});
      await tx.banner.create({
        data: {
          image: '/images/banners/home/tz-future.jpg',
          title: vi('tz-future'),
          href: '/du-an',
          isActive: true,
          displayFrom: new Date(now.getTime() + 3 * HOUR_MS),
        },
      });
      await tx.banner.create({
        data: {
          image: '/images/banners/home/tz-expired.jpg',
          title: vi('tz-expired'),
          href: '/du-an',
          isActive: true,
          displayUntil: new Date(now.getTime() - 3 * HOUR_MS),
        },
      });
      await tx.banner.create({
        data: {
          image: '/images/banners/home/tz-plain.jpg',
          title: vi('tz-plain'),
          href: '/du-an',
          isActive: true,
        },
      });

      const [session] = await tx.$queryRaw<
        { tz: string }[]
      >`SELECT current_setting('TimeZone') AS tz`;

      return { keys: await visibleKeys(tx, now), tz: session.tz };
    });

    expect(seen.tz).toBe(TZ);
    expect(seen.keys).toEqual(['tz-plain']);
  });

  /**
   * §55 — tiêu chí nghiệm thu cứng. Hàng có sẵn từ trước Batch 12 mang hai cột
   * NULL; chúng phải hành xử y hệt lúc chỉ có `is_active`.
   */
  it('tương thích ngược: hàng cũ (hai cột NULL) hành xử đúng như trước', async () => {
    const seen = await inBangkokTx(async (tx, now) => {
      await tx.banner.deleteMany({});
      // Ghi bằng SQL thô, KHÔNG đi qua Prisma create — mô phỏng đúng hàng đã có
      // trong DB trước khi migration chạy.
      await tx.$executeRaw`
        INSERT INTO "banners" ("id", "image", "title", "href", "order", "is_active", "created_at", "updated_at")
        VALUES
          ('legacy-on',  '/images/banners/home/legacy-on.jpg',  '{"vi":"legacy-on"}'::jsonb,  '/du-an', 0, true,  NOW(), NOW()),
          ('legacy-off', '/images/banners/home/legacy-off.jpg', '{"vi":"legacy-off"}'::jsonb, '/du-an', 1, false, NOW(), NOW())`;

      const [row] = await tx.$queryRaw<
        { display_from: Date | null; display_until: Date | null }[]
      >`SELECT "display_from", "display_until" FROM "banners" WHERE "id" = 'legacy-on'`;

      return {
        keys: await visibleKeys(tx, now),
        window: row,
        // Xa cả về quá khứ lẫn tương lai vẫn không đổi gì.
        farPast: await visibleKeys(
          tx,
          new Date(now.getTime() - 5000 * HOUR_MS),
        ),
        farFuture: await visibleKeys(
          tx,
          new Date(now.getTime() + 5000 * HOUR_MS),
        ),
      };
    });

    expect(seen.window.display_from).toBeNull();
    expect(seen.window.display_until).toBeNull();
    expect(seen.keys).toEqual(['legacy-on']);
    expect(seen.farPast).toEqual(['legacy-on']);
    expect(seen.farFuture).toEqual(['legacy-on']);
  });

  /**
   * §53 — Render Free ngủ suốt cả cửa sổ. Vì mọi thứ nằm ở vị từ truy vấn nên
   * không có gì phải "bù" lúc thức dậy: cùng một hàng, không hề chạm tới, cho ra
   * ba kết quả khác nhau ở ba thời điểm. Test này mô phỏng đúng điều đó — không
   * có mutation nào giữa ba lần đọc.
   */
  it('không cần reconciliation lúc thức dậy: cùng một hàng, ba mốc, ba kết quả', async () => {
    const seen = await inBangkokTx(async (tx, now) => {
      await tx.banner.deleteMany({});
      const row = await tx.banner.create({
        data: {
          image: '/images/banners/home/sleep.jpg',
          title: vi('sleep'),
          href: '/du-an',
          isActive: true,
          displayFrom: new Date(now.getTime() + HOUR_MS),
          displayUntil: new Date(now.getTime() + 2 * HOUR_MS),
        },
      });

      const before = await visibleKeys(tx, now);
      const during = await visibleKeys(
        tx,
        new Date(now.getTime() + 1.5 * HOUR_MS),
      );
      const after = await visibleKeys(
        tx,
        new Date(now.getTime() + 3 * HOUR_MS),
      );

      const stored = await tx.banner.findUniqueOrThrow({
        where: { id: row.id },
      });
      return {
        before,
        during,
        after,
        updatedAt: stored.updatedAt,
        created: row.updatedAt,
      };
    });

    expect(seen.before).toEqual([]);
    expect(seen.during).toEqual(['sleep']);
    expect(seen.after).toEqual([]);
    // Không có mutation nào xảy ra giữa chừng — `updated_at` đứng yên.
    expect(seen.updatedAt).toEqual(seen.created);
  });
});
