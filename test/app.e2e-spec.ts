/**
 * E2E smoke (task →8) — thay boilerplate "Hello World!" của Nest CLI.
 *
 * Chạy vòng đời nội dung THẬT qua HTTP, đúng luồng audit gợi ý (đăng nhập →
 * tạo nháp → nháp không lộ ra public → đăng → thấy ở public):
 * cần Postgres sống (DATABASE_URL) + admin đã seed (prisma/seed.js với
 * ADMIN_EMAIL/ADMIN_PASSWORD). CI dựng service container Postgres dùng một lần;
 * KHÔNG chạy vào DB production.
 *
 * Bootstrap lặp lại đúng cấu hình main.ts (prefix `api`, ValidationPipe,
 * ResponseInterceptor, HttpExceptionFilter) — bỏ helmet/CORS/Swagger vì không
 * đổi hành vi route.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

/** Envelope chuẩn của ResponseInterceptor — supertest trả `body: any`. */
type Envelope<T> = { success: boolean; data: T; message: string | null };

type NewsPostBody = {
  slug: string;
  status: string;
  publishedAt: string | null;
  title: { vi: string; en?: string };
};

type MeBody = { id: string; email: string; name: string; role: string };

/**
 * Vai trò BẮT BUỘC của tài khoản bootstrap E2E.
 *
 * `initialContentStatus()` cho SUPER_ADMIN bỏ qua luồng duyệt → bài tạo mới ra
 * thẳng `PUBLISHED`. Smoke test dưới đây khẳng định bài mới phải là `DRAFT`, nên
 * chỉ đúng khi đăng nhập bằng tài khoản **ADMIN**. `prisma/seed.js` mặc định
 * `ADMIN_ROLE = SUPER_ADMIN`, vì vậy môi trường chạy test PHẢI đặt
 * `ADMIN_ROLE=ADMIN` (xem job `e2e` trong `.github/workflows/ci.yml`).
 */
const REQUIRED_BOOTSTRAP_ROLE = 'ADMIN';

// Slug duy nhất mỗi lần chạy — chạy lại không đụng bản ghi cũ còn sót.
const SLUG = `e2e-smoke-${Date.now()}`;

describe('Smoke e2e — đăng nhập → nháp → đăng → public (task →8)', () => {
  let app: INestApplication<App>;
  let http: App;
  let accessToken: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'Thiếu DATABASE_URL — e2e cần Postgres thật (xem ci.yml job e2e).',
      );
    }
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      throw new Error(
        'Thiếu ADMIN_EMAIL/ADMIN_PASSWORD — phải khớp tài khoản đã seed bằng prisma/seed.js.',
      );
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
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
  });

  afterAll(async () => {
    // Nếu beforeAll fail trước khi app khởi tạo, đừng gọi app.close()/request()
    // trên biến undefined — sẽ nuốt mất lỗi setup gốc bằng một TypeError khác.
    if (!app) {
      return;
    }
    // Dọn bài test nếu còn (kể cả khi test giữa chừng fail).
    if (accessToken) {
      await request(http)
        .delete(`/api/news/${SLUG}`)
        .set('Authorization', `Bearer ${accessToken}`);
    }
    await app.close();
  });

  it('GET /api sống và trả envelope {success: true}', async () => {
    const res = await request(http).get('/api').expect(200);
    expect((res.body as Envelope<string>).success).toBe(true);
  });

  it('route ghi bị chặn khi không có token (401)', async () => {
    await request(http)
      .post('/api/news')
      .send({ slug: SLUG, title: { vi: 'x' }, summary: { vi: 'x' } })
      .expect(401);
  });

  it('đăng nhập bằng tài khoản seed → nhận accessToken', async () => {
    const res = await request(http)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(201);

    const body = res.body as Envelope<{ accessToken: string }>;
    expect(body.success).toBe(true);
    expect(typeof body.data.accessToken).toBe('string');
    accessToken = body.data.accessToken;
  });

  // Chốt CHẨN ĐOÁN trước khi khẳng định DRAFT: nếu tài khoản bootstrap bị seed
  // sai vai trò thì fail ngay tại đây với thông điệp chỉ đúng nguyên nhân, thay
  // vì để test sau báo "Expected: DRAFT / Received: PUBLISHED" — triệu chứng đó
  // không nói được rằng lỗi nằm ở env seed chứ không phải ở logic news.
  // KHÔNG in email, mật khẩu, JWT, cookie hay DATABASE_URL.
  it('tài khoản bootstrap phải có vai trò ADMIN (chẩn đoán seed/env)', async () => {
    const res = await request(http)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const { role } = (res.body as Envelope<MeBody>).data;
    // `expect()` của jest KHÔNG nhận tham số message, nên ném lỗi tường minh để
    // thông điệp chẩn đoán thực sự hiện trong log CI. `role` chỉ là enum
    // (EDITOR/ADMIN/SUPER_ADMIN) — in ra an toàn, không phải dữ liệu nhạy cảm.
    if (role !== REQUIRED_BOOTSTRAP_ROLE) {
      throw new Error(
        'Expected bootstrap E2E account role ADMIN. ' +
          `Check ADMIN_ROLE and seed upsert. (đang nhận: ${role})`,
      );
    }
    expect(role).toBe(REQUIRED_BOOTSTRAP_ROLE);
  });

  it('tạo bài nháp — mặc định DRAFT, chưa có publishedAt', async () => {
    const res = await request(http)
      .post('/api/news')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        slug: SLUG,
        title: { vi: 'Bài smoke e2e', en: 'E2E smoke post' },
        summary: { vi: 'Bài tự sinh bởi e2e — sẽ bị xóa sau khi chạy.' },
        content: [{ vi: 'Đoạn nội dung kiểm thử.' }],
      })
      .expect(201);

    const { data } = res.body as Envelope<NewsPostBody>;
    expect(data.slug).toBe(SLUG);
    expect(data.status).toBe('DRAFT');
    expect(data.publishedAt).toBeNull();
  });

  it('bài nháp KHÔNG lộ ra route public (list lẫn chi tiết)', async () => {
    const list = await request(http).get('/api/news').expect(200);
    const slugs = (list.body as Envelope<NewsPostBody[]>).data.map(
      (post) => post.slug,
    );
    expect(slugs).not.toContain(SLUG);

    // Đoán đúng slug cũng không đọc được bài nháp (chống lộ nội dung chưa duyệt)
    await request(http).get(`/api/news/${SLUG}`).expect(404);
  });

  it('duyệt đăng (PATCH status) → bài xuất hiện ở public kèm publishedAt', async () => {
    const publish = await request(http)
      .patch(`/api/news/${SLUG}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'PUBLISHED' })
      .expect(200);
    expect(
      (publish.body as Envelope<NewsPostBody>).data.publishedAt,
    ).not.toBeNull();

    const detail = await request(http).get(`/api/news/${SLUG}`).expect(200);
    const { data } = detail.body as Envelope<NewsPostBody>;
    expect(data.status).toBe('PUBLISHED');
    expect(data.title.vi).toBe('Bài smoke e2e');

    const list = await request(http).get('/api/news').expect(200);
    const slugs = (list.body as Envelope<NewsPostBody[]>).data.map(
      (post) => post.slug,
    );
    expect(slugs).toContain(SLUG);
  });

  it('xóa bài test → public trả 404 (dọn dữ liệu)', async () => {
    await request(http)
      .delete(`/api/news/${SLUG}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    await request(http).get(`/api/news/${SLUG}`).expect(404);
  });

  it('payload sai bị ValidationPipe chặn (400) — slug vượt trần →3', async () => {
    await request(http)
      .post('/api/news')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        slug: 'a'.repeat(161), // MaxLength(160)
        title: { vi: 'x' },
        summary: { vi: 'x' },
      })
      .expect(400);
  });
});
