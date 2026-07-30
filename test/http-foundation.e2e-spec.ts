/**
 * Integration HTTP foundation (AUDIT-M1, phase 3) — chạy trên PostgreSQL THẬT.
 *
 * Phủ những case tầng HTTP mà unit test không chạm tới được vì chúng phát sinh
 * ở *middleware* / *pipe* trước khi vào controller: JSON dị dạng, content-type
 * lạ, vượt trần body, field lạ bị whitelist chặn, enum sai, 404/409, và hình
 * dạng envelope lỗi.
 *
 * Bootstrap lặp lại `main.ts` **kèm `useBodyParser`** — thiếu nó thì trần body
 * là mặc định 100 kb của Express và test 413 sẽ đo sai chỗ.
 *
 * Hai case là hồi quy của defect tìm ra trong đợt audit này:
 *   D1 — vượt trần body trả 500 thay vì 413.
 *   D2 — thiếu field song ngữ bắt buộc trả 500 (Prisma) thay vì 400.
 */
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import {
  JSON_BODY_LIMIT,
  JSON_BODY_LIMIT_BYTES,
} from '../src/common/body-limit';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL;
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;

type Envelope<T> = { success: boolean; data: T; message: string | null };
type ErrorEnvelope = {
  success: false;
  error: { code: string; message: unknown; details: unknown };
};

const SLUG = `e2e-foundation-${Date.now()}`;

describe('HTTP foundation e2e (PostgreSQL thật)', () => {
  // Kiểu NestExpressApplication (không phải INestApplication) để dùng
  // `useBodyParser` — trần body là thứ case 413 cần đo.
  let app: NestExpressApplication;
  let http: App;
  let token: string;
  const createdSlugs: string[] = [];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'Thiếu DATABASE_URL — cần Postgres cục bộ thien_duc_test.',
      );
    }
    if (!SUPER_EMAIL || !SUPER_PASSWORD) {
      throw new Error(
        'Thiếu SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD (khớp prisma/seed-e2e.js).',
      );
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api');
    // Trần body PHẢI khớp main.ts, nếu không case 413 đo sai ngưỡng.
    app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    http = app.getHttpServer();

    const login = await request(http)
      .post('/api/auth/login')
      .send({ email: SUPER_EMAIL, password: SUPER_PASSWORD })
      // Nest trả 201 cho POST (controller không đặt @HttpCode) — hợp đồng này
      // cũng được khoá ở app.e2e-spec.ts và admin/e2e/.../forgot-reset.e2e.ts.
      .expect(201);
    token = (login.body as Envelope<{ accessToken: string }>).data.accessToken;
    expect(typeof token).toBe('string');
  });

  afterAll(async () => {
    if (!app) return;
    for (const slug of createdSlugs) {
      await request(http)
        .delete(`/api/news/${slug}`)
        .set('Authorization', `Bearer ${token}`);
    }
    await app.close();
  });

  /**
   * Tạo bài hợp lệ, tự ghi nhận để dọn ở afterAll. KHÔNG `async` — phải trả
   * chính đối tượng supertest để nơi gọi còn `.expect()` được.
   */
  function createNews(slug: string) {
    createdSlugs.push(slug);
    return request(http)
      .post('/api/news')
      .set('Authorization', `Bearer ${token}`)
      .send({ slug, title: { vi: 'Tiêu đề' }, summary: { vi: 'Tóm tắt' } });
  }

  describe('envelope + hợp đồng cơ bản', () => {
    it('GET /api trả envelope success', async () => {
      const res = await request(http).get('/api').expect(200);
      expect((res.body as Envelope<string>).success).toBe(true);
    });

    it('lỗi luôn có hình dạng {success:false, error:{code,message}}', async () => {
      const res = await request(http)
        .get('/api/news/khong-ton-tai-xyz')
        .expect(404);
      const body = res.body as ErrorEnvelope;
      expect(body.success).toBe(false);
      expect(typeof body.error.code).toBe('string');
      expect(body.error.message).toBeDefined();
    });
  });

  describe('ValidationPipe — whitelist + forbidNonWhitelisted', () => {
    it('field lạ bị từ chối 400 (không phải bị bỏ qua âm thầm)', async () => {
      await request(http)
        .post('/api/news')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slug: `${SLUG}-unknown`,
          title: { vi: 't' },
          summary: { vi: 's' },
          fieldKhongTonTai: 'x',
        })
        .expect(400);
    });

    it('không mass-assign được `status` / `publishedAt` qua create', async () => {
      for (const evil of [
        { status: 'PUBLISHED' },
        { publishedAt: '2020-01-01T00:00:00.000Z' },
      ]) {
        await request(http)
          .post('/api/news')
          .set('Authorization', `Bearer ${token}`)
          .send({
            slug: `${SLUG}-mass`,
            title: { vi: 't' },
            summary: { vi: 's' },
            ...evil,
          })
          .expect(400);
      }
    });

    it('sai kiểu (title là chuỗi thay vì object) → 400', async () => {
      await request(http)
        .post('/api/news')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slug: `${SLUG}-type`,
          title: 'chuỗi trần',
          summary: { vi: 's' },
        })
        .expect(400);
    });

    it('enum sai → 400', async () => {
      const slug = `${SLUG}-enum`;
      await createNews(slug).expect(201);
      await request(http)
        .patch(`/api/news/${slug}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'KHONG_PHAI_TRANG_THAI' })
        .expect(400);
    });

    it('vượt trần độ dài slug → 400; đúng ở trần → chấp nhận', async () => {
      await request(http)
        .post('/api/news')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slug: 'a'.repeat(161),
          title: { vi: 't' },
          summary: { vi: 's' },
        })
        .expect(400);

      const atLimit = `${'b'.repeat(160 - SLUG.length - 1)}-${SLUG}`.slice(
        0,
        160,
      );
      await createNews(atLimit).expect(201);
    });

    it('lỗi nested chỉ đúng đường dẫn field (content.1.vi)', async () => {
      const res = await request(http)
        .post('/api/news')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slug: `${SLUG}-nested`,
          title: { vi: 't' },
          summary: { vi: 's' },
          content: [{ vi: 'ok' }, { vi: 'x'.repeat(100_001) }],
        })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('content.1.vi');
    });
  });

  // Hồi quy D2 — trước bản sửa đây là 500 (PrismaClientValidationError).
  describe('D2 — thiếu field song ngữ bắt buộc → 400, KHÔNG phải 500', () => {
    const missing: Array<[string, string, Record<string, unknown>]> = [
      [
        'news thiếu title',
        '/api/news',
        { slug: `${SLUG}-m1`, summary: { vi: 's' } },
      ],
      [
        'news thiếu summary',
        '/api/news',
        { slug: `${SLUG}-m2`, title: { vi: 't' } },
      ],
      [
        'projects thiếu title',
        '/api/projects',
        { slug: `${SLUG}-m3`, summary: { vi: 's' }, status: 'DA_BAN_GIAO' },
      ],
      [
        'pages thiếu title',
        '/api/pages',
        { slug: `${SLUG}-m4`, content: [{ vi: 'c' }] },
      ],
      [
        'banners thiếu title',
        '/api/banners',
        { image: '/audit-probe.png', href: '/du-an' },
      ],
    ];

    it.each(missing)('%s', async (_label, path, payload) => {
      const res = await request(http)
        .post(path)
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(400);
      // Không được lộ dấu vết Prisma / stack ra client.
      expect(JSON.stringify(res.body)).not.toMatch(
        /Prisma|invocation|node_modules/i,
      );
    });
  });

  describe('lỗi tầng middleware', () => {
    it('JSON dị dạng → 400', async () => {
      await request(http)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": "a@b.c", ')
        .expect(400);
    });

    it('content-type không hỗ trợ → 400, không phải 500', async () => {
      await request(http)
        .post('/api/auth/login')
        .set('Content-Type', 'text/plain')
        .send('khong-phai-json')
        .expect(400);
    });

    // Hồi quy D1 — trước bản sửa đây là 500 "Internal server error".
    it('D1 — body vượt trần → 413 kèm thông điệp an toàn', async () => {
      const oversized = 'x'.repeat(JSON_BODY_LIMIT_BYTES + 1024);
      const res = await request(http)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ email: 'a@b.c', password: oversized }))
        .expect(413);

      const body = res.body as ErrorEnvelope;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(body.error.details).toBeNull();
      expect(JSON.stringify(body)).not.toMatch(
        /entity\.too\.large|node_modules/,
      );
    });
  });

  describe('404 / 409 / không lộ nội bộ', () => {
    it('slug không tồn tại → 404', async () => {
      await request(http).get('/api/news/khong-ton-tai-abc-123').expect(404);
    });

    it('id không phải UUID → 404 sạch, KHÔNG 500', async () => {
      const res = await request(http)
        .get('/api/users/khong-phai-uuid')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect(JSON.stringify(res.body)).not.toMatch(
        /Prisma|invalid input syntax/i,
      );
    });

    it('slug trùng → 409 (không rơi thành 500)', async () => {
      const slug = `${SLUG}-dup`;
      await createNews(slug).expect(201);
      const res = await request(http)
        .post('/api/news')
        .set('Authorization', `Bearer ${token}`)
        .send({ slug, title: { vi: 't' }, summary: { vi: 's' } })
        .expect(409);
      expect((res.body as ErrorEnvelope).error.code).toBe('Conflict');
    });

    it('response lỗi không chứa stack trace / đường dẫn file', async () => {
      const res = await request(http)
        .get('/api/news/khong-ton-tai-stack')
        .expect(404);
      expect(JSON.stringify(res.body)).not.toMatch(
        /\.ts:\d+|\.js:\d+|node_modules|at Object\./,
      );
    });
  });

  // ===================== AUDIT-M2 =====================

  describe('M2 — URL scheme nguy hiểm bị chặn ở tầng API (server-side)', () => {
    const TAB = String.fromCharCode(9);
    const dangerous: Array<[string, string]> = [
      ['javascript thường', 'javascript:alert(1)'],
      ['javascript HOA/thường', 'JaVaScRiPt:alert(1)'],
      ['khoảng trắng đầu', '  javascript:alert(1)'],
      ['tab chèn giữa scheme', `java${TAB}script:alert(1)`],
      ['data text/html', 'data:text/html,<h1>pwned</h1>'],
      ['vbscript', 'vbscript:msgbox(1)'],
      ['protocol-relative', '//evil.example.com/phish'],
      ['host ngoài', 'https://evil.example.com/phish'],
    ];

    it.each(dangerous)('banner.href — %s → 400', async (_label, href) => {
      await request(http)
        .post('/api/banners')
        .set('Authorization', `Bearer ${token}`)
        .send({ image: '/images/probe.png', href, title: { vi: 'probe' } })
        .expect(400);
    });

    it('banner.image — data:image/svg+xml (payload onload) → 400', async () => {
      await request(http)
        .post('/api/banners')
        .set('Authorization', `Bearer ${token}`)
        .send({
          image: 'data:image/svg+xml,<svg onload=alert(1)>',
          href: '/du-an',
          title: { vi: 'probe' },
        })
        .expect(400);
    });

    it('news.image — javascript: → 400', async () => {
      await request(http)
        .post('/api/news')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slug: `${SLUG}-imgjs`,
          title: { vi: 't' },
          summary: { vi: 's' },
          image: 'javascript:alert(1)',
        })
        .expect(400);
    });

    it('giá trị hợp lệ vẫn qua: đường dẫn nội bộ + URL https', async () => {
      const slug = `${SLUG}-imgok`;
      createdSlugs.push(slug);
      await request(http)
        .post('/api/news')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slug,
          title: { vi: 't' },
          summary: { vi: 's' },
          image: 'https://res.cloudinary.com/demo/image/upload/v1/a.webp',
        })
        .expect(201);
    });
  });

  describe('M2 — chuỗi bắt buộc chỉ gồm khoảng trắng bị chặn (D5)', () => {
    const TAB = String.fromCharCode(9);
    const NBSP = String.fromCharCode(0x00a0);

    it.each([[''], [' '], ['   '], [TAB], [NBSP]])(
      'news title.vi = %j → 400',
      async (vi) => {
        await request(http)
          .post('/api/news')
          .set('Authorization', `Bearer ${token}`)
          .send({ slug: `${SLUG}-blank`, title: { vi }, summary: { vi: 's' } })
          .expect(400);
      },
    );

    it('contact message chỉ khoảng trắng → 400 (route công khai)', async () => {
      await request(http)
        .post('/api/contact')
        .send({ name: 'A', phone: '0900000000', message: '   ' })
        .expect(400);
    });

    it('khoảng trắng quanh nội dung THẬT vẫn được nhận', async () => {
      const slug = `${SLUG}-trim`;
      createdSlugs.push(slug);
      await request(http)
        .post('/api/news')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slug,
          title: { vi: '  Tiêu đề thật  ' },
          summary: { vi: 's' },
        })
        .expect(201);
    });
  });

  describe('M2 — trần số đoạn content[] (D6)', () => {
    const block = { vi: 'đoạn' };

    it('đúng trần (500 đoạn) → 201', async () => {
      const slug = `${SLUG}-b500`;
      createdSlugs.push(slug);
      await request(http)
        .post('/api/news')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slug,
          title: { vi: 't' },
          summary: { vi: 's' },
          content: Array.from({ length: 500 }, () => ({ ...block })),
        })
        .expect(201);
    });

    it('trần + 1 (501 đoạn) → 400', async () => {
      await request(http)
        .post('/api/news')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slug: `${SLUG}-b501`,
          title: { vi: 't' },
          summary: { vi: 's' },
          content: Array.from({ length: 501 }, () => ({ ...block })),
        })
        .expect(400);
    });

    it('5.000 đoạn (defect gốc, từng trả 201) → 400', async () => {
      await request(http)
        .post('/api/news')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slug: `${SLUG}-b5000`,
          title: { vi: 't' },
          summary: { vi: 's' },
          content: Array.from({ length: 5000 }, () => ({ ...block })),
        })
        .expect(400);
    });
  });

  describe('phân quyền tầng HTTP', () => {
    it('route ghi không token → 401', async () => {
      await request(http)
        .post('/api/news')
        .send({ slug: `${SLUG}-401`, title: { vi: 't' }, summary: { vi: 's' } })
        .expect(401);
    });

    it('token rác → 401', async () => {
      await request(http)
        .get('/api/users')
        .set('Authorization', 'Bearer khong-phai-jwt')
        .expect(401);
    });
  });

  describe('nội dung chưa đăng KHÔNG lộ qua route công khai', () => {
    it('bài DRAFT không có ở list lẫn chi tiết public', async () => {
      const slug = `${SLUG}-draft`;
      await createNews(slug).expect(201);
      // SUPER_ADMIN tạo là PUBLISHED ngay → hạ về DRAFT để kiểm.
      await request(http)
        .patch(`/api/news/${slug}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'DRAFT' })
        .expect(200);

      await request(http).get(`/api/news/${slug}`).expect(404);
      const list = await request(http).get('/api/news').expect(200);
      const slugs = (list.body as Envelope<Array<{ slug: string }>>).data.map(
        (p) => p.slug,
      );
      expect(slugs).not.toContain(slug);
    });

    it('bài PENDING cũng không lộ', async () => {
      const slug = `${SLUG}-pending`;
      await createNews(slug).expect(201);
      await request(http)
        .patch(`/api/news/${slug}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'PENDING' })
        .expect(200);

      await request(http).get(`/api/news/${slug}`).expect(404);
    });
  });
});
