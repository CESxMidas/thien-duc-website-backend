/**
 * CMS-RETIRE-DIRECT-USER-CREATE-M1 — hồi quy cho route đã gỡ.
 *
 * Trước đây `POST /api/users` cho SUPER_ADMIN tạo thẳng một tài khoản kèm mật
 * khẩu do quản trị viên chọn. Route đó đã bị **gỡ hẳn** (không stub, không 410):
 * cấp tài khoản chỉ còn qua lời mời, người được mời tự đặt mật khẩu.
 *
 * Bộ test này chứng minh trên PostgreSQL thật (thien_duc_test):
 *   1. Route không còn tồn tại → 404 (kể cả khi đã đăng nhập SUPER_ADMIN).
 *   2. Payload tạo-trực-tiếp hợp lệ về hình thức KHÔNG ghi được hàng nào vào DB.
 *   3. Payload kèm `password` / `passwordHash` cũng vậy.
 *   4. Lời mời (`POST /api/users/invitations`) vẫn là lối cấp tài khoản duy
 *      nhất và vẫn hoạt động — tạo đúng MỘT tài khoản, chưa thiết lập xong.
 *   5. ADMIN / EDITOR / khách không mời được (403 / 401).
 *
 * Fixture dùng domain @e2e.test và được dọn sau mỗi test; tài khoản seed không
 * bị đụng tới. Email chạy qua transport GIẢ (`test/e2e-setup.ts`).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../generated/prisma/client';

const E2E_DOMAIN = '@e2e.test';
const PASSWORD = 'RetiredRoutePass123';

describe('POST /api/users đã bị gỡ (CMS-RETIRE-DIRECT-USER-CREATE-M1)', () => {
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'Thiếu DATABASE_URL — integration test cần Postgres thật.',
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
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  /**
   * `AccountInvitation.invitedBy` là FK `onDelete: Restrict` — xoá thẳng user
   * fixture sẽ vi phạm ràng buộc và bỏ lại rác cho các suite sau. Vì vậy xoá
   * lời mời do fixture gửi TRƯỚC, rồi mới xoá user.
   */
  async function cleanup(): Promise<void> {
    await prisma.accountInvitation.deleteMany({
      where: {
        OR: [
          { user: { email: { endsWith: E2E_DOMAIN } } },
          { invitedBy: { email: { endsWith: E2E_DOMAIN } } },
        ],
      },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: E2E_DOMAIN } },
    });
  }
  beforeAll(cleanup);
  afterEach(cleanup);

  const uniq = (p: string) =>
    `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}${E2E_DOMAIN}`;

  /** Tạo một tài khoản đã thiết lập xong với vai trò cho trước + lấy access token. */
  async function loginAs(role: Role): Promise<string> {
    const email = uniq(`actor-${role.toLowerCase()}`);
    await prisma.user.create({
      data: {
        email,
        name: `Actor ${role}`,
        role,
        passwordHash: await bcrypt.hash(PASSWORD, 12),
        isActive: true,
        setupCompletedAt: new Date(),
      },
    });
    const res = await request(http)
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    const body = res.body as { data: { accessToken: string } };
    return body.data.accessToken;
  }

  const countUsers = (email: string) => prisma.user.count({ where: { email } });

  describe('route không còn tồn tại', () => {
    it('khách (không đăng nhập): 404 route-not-found, không phải 401/201', async () => {
      const email = uniq('anon-create');
      await request(http)
        .post('/api/users')
        .send({ email, name: 'X', role: 'EDITOR', password: PASSWORD })
        .expect(404);

      expect(await countUsers(email)).toBe(0);
    });

    it('SUPER_ADMIN đã đăng nhập vẫn nhận 404 (route bị gỡ, không phải bị chặn quyền)', async () => {
      const token = await loginAs(Role.SUPER_ADMIN);
      const email = uniq('sa-create');

      const res = await request(http)
        .post('/api/users')
        .set('Authorization', `Bearer ${token}`)
        .send({ email, name: 'Người mới', role: 'EDITOR', password: PASSWORD })
        .expect(404);

      const body = res.body as { success: boolean };
      expect(body.success).toBe(false);
      expect(await countUsers(email)).toBe(0);
    });

    it.each([
      ['password', { password: PASSWORD }],
      ['passwordHash', { passwordHash: '$2b$12$gia.mao.hash.khong.hop.le' }],
      ['cả hai', { password: PASSWORD, passwordHash: 'x' }],
      ['không mật khẩu', {}],
    ])(
      'payload "%s" KHÔNG ghi hàng nào vào DB',
      async (_label, extra: Record<string, unknown>) => {
        const token = await loginAs(Role.SUPER_ADMIN);
        const email = uniq('payload');

        await request(http)
          .post('/api/users')
          .set('Authorization', `Bearer ${token}`)
          .send({ email, name: 'Người mới', role: 'EDITOR', ...extra })
          .expect(404);

        expect(await countUsers(email)).toBe(0);
      },
    );

    it('không tổng số tài khoản nào tăng lên sau một loạt lần thử', async () => {
      const token = await loginAs(Role.SUPER_ADMIN);
      const before = await prisma.user.count();

      for (let i = 0; i < 5; i += 1) {
        await request(http)
          .post('/api/users')
          .set('Authorization', `Bearer ${token}`)
          .send({
            email: uniq(`loat-${i}`),
            name: 'Người mới',
            role: 'SUPER_ADMIN',
            password: PASSWORD,
          })
          .expect(404);
      }

      expect(await prisma.user.count()).toBe(before);
    });
  });

  describe('lời mời là lối cấp tài khoản duy nhất còn lại', () => {
    it('SUPER_ADMIN mời được — tạo đúng MỘT tài khoản, chưa thiết lập xong', async () => {
      const token = await loginAs(Role.SUPER_ADMIN);
      const email = uniq('duoc-moi');

      const res = await request(http)
        .post('/api/users/invitations')
        .set('Authorization', `Bearer ${token}`)
        .send({ email, name: 'Người được mời', role: 'EDITOR' })
        .expect(201);

      expect(await countUsers(email)).toBe(1);
      const created = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(created.setupCompletedAt).toBeNull();

      // Response không bao giờ chứa token thô hay bất kỳ hash nào.
      const raw = JSON.stringify(res.body);
      expect(raw).not.toMatch(/passwordHash/i);
      expect(raw).not.toMatch(/tokenHash/i);
      expect(raw).not.toContain(PASSWORD);
    });

    it('lời mời KHÔNG nhận field password (400, không tạo tài khoản)', async () => {
      const token = await loginAs(Role.SUPER_ADMIN);
      const email = uniq('moi-kem-mk');

      await request(http)
        .post('/api/users/invitations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          email,
          name: 'Người được mời',
          role: 'EDITOR',
          password: PASSWORD,
        })
        .expect(400);

      expect(await countUsers(email)).toBe(0);
    });

    it.each([[Role.ADMIN], [Role.EDITOR]])(
      '%s không mời được (403), không tạo tài khoản',
      async (role) => {
        const token = await loginAs(role);
        const email = uniq('bi-chan');

        await request(http)
          .post('/api/users/invitations')
          .set('Authorization', `Bearer ${token}`)
          .send({ email, name: 'Người được mời', role: 'EDITOR' })
          .expect(403);

        expect(await countUsers(email)).toBe(0);
      },
    );

    it('chưa đăng nhập thì mời bị 401', async () => {
      const email = uniq('khach-moi');
      await request(http)
        .post('/api/users/invitations')
        .send({ email, name: 'Người được mời', role: 'EDITOR' })
        .expect(401);

      expect(await countUsers(email)).toBe(0);
    });
  });
});
