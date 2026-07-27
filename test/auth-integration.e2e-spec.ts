/**
 * Integration test THẬT với PostgreSQL cô lập (thien_duc_test) — KHÔNG mock DB.
 * Kiểm các bất biến chỉ chứng minh được ở tầng CSDL: claim nguyên tử khi có tương
 * tranh, ràng buộc unique tokenHash, rollback giao dịch, cascade khi xoá user,
 * và thu hồi refresh token sau khi đặt lại mật khẩu.
 *
 * Chạy bằng `npm run test:e2e` (cần DATABASE_URL sống). Mọi fixture dùng domain
 * @e2e.test và được dọn sau mỗi test, không đụng tài khoản seed.
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
import { generateOpaqueToken } from '../src/common/utils/opaque-token.util';

const E2E_DOMAIN = '@e2e.test';
const PASSWORD = 'IntegimestPass123';
const NEW_PASSWORD = 'IntegNewPass456';

describe('Auth integration (PostgreSQL thật)', () => {
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

  async function cleanup(): Promise<void> {
    await prisma.user.deleteMany({
      where: { email: { endsWith: E2E_DOMAIN } },
    });
  }
  afterEach(cleanup);

  /** Tạo user active (đã thiết lập) với mật khẩu biết trước. */
  async function createActiveUser(email: string) {
    return prisma.user.create({
      data: {
        email,
        name: 'Integ',
        role: 'EDITOR',
        passwordHash: await bcrypt.hash(PASSWORD, 12),
        isActive: true,
        setupCompletedAt: new Date(),
      },
    });
  }

  /** Tạo user pending + một lời mời hợp lệ; trả token bản rõ. */
  async function createPendingWithInvitation(email: string) {
    const user = await prisma.user.create({
      data: {
        email,
        name: 'Integ Pending',
        role: 'EDITOR',
        passwordHash: await bcrypt.hash('placeholder-unknowable', 12),
        isActive: true,
        setupCompletedAt: null,
      },
    });
    const { token, tokenHash } = generateOpaqueToken();
    await prisma.accountInvitation.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        invitedById: user.id,
      },
    });
    return { user, token };
  }

  const uniq = (p: string) =>
    `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}${E2E_DOMAIN}`;

  it('nhận lời mời tương tranh: đúng MỘT request thành công', async () => {
    const { user, token } = await createPendingWithInvitation(uniq('accept'));
    const attempts = Array.from({ length: 6 }, () =>
      request(http).post('/api/auth/accept-invitation').send({
        token,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      }),
    );
    const results = await Promise.all(attempts);
    const ok = results.filter((r) => r.status < 400);
    expect(ok).toHaveLength(1);

    // Trạng thái nhất quán: đúng một lần dùng, setup hoàn tất một lần.
    const invitations = await prisma.accountInvitation.findMany({
      where: { userId: user.id },
    });
    expect(invitations.filter((i) => i.usedAt !== null)).toHaveLength(1);
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after!.setupCompletedAt).not.toBeNull();
  });

  it('đặt lại mật khẩu tương tranh: đúng MỘT request thành công', async () => {
    const user = await createActiveUser(uniq('reset'));
    const { token, tokenHash } = generateOpaqueToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
      },
    });
    const attempts = Array.from({ length: 6 }, () =>
      request(http).post('/api/auth/reset-password').send({
        token,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      }),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r.status < 400)).toHaveLength(1);
    const tokens = await prisma.passwordResetToken.findMany({
      where: { userId: user.id },
    });
    expect(tokens.filter((t) => t.usedAt !== null)).toHaveLength(1);
  });

  it('ràng buộc unique tokenHash của lời mời', async () => {
    const user = await createActiveUser(uniq('uniq-inv'));
    const { tokenHash } = generateOpaqueToken();
    const base = {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 3600_000),
      invitedById: user.id,
    };
    await prisma.accountInvitation.create({ data: base });
    await expect(
      prisma.accountInvitation.create({ data: base }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('ràng buộc unique tokenHash của reset token', async () => {
    const user = await createActiveUser(uniq('uniq-reset'));
    const { tokenHash } = generateOpaqueToken();
    const base = {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 1200_000),
    };
    await prisma.passwordResetToken.create({ data: base });
    await expect(
      prisma.passwordResetToken.create({ data: base }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rollback giao dịch: lỗi giữa chừng → KHÔNG ghi phần nào', async () => {
    const email = uniq('rollback');
    const { tokenHash } = generateOpaqueToken();
    // Chiếm trước tokenHash để bước thứ hai trong tx vi phạm unique.
    const seed = await createActiveUser(uniq('rollback-seed'));
    await prisma.accountInvitation.create({
      data: {
        userId: seed.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 3600_000),
        invitedById: seed.id,
      },
    });
    await expect(
      prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            email,
            name: 'Rollback',
            role: 'EDITOR',
            passwordHash: await bcrypt.hash('x', 4),
            setupCompletedAt: null,
          },
        });
        // Vi phạm unique → toàn bộ tx rollback (user vừa tạo cũng bị hủy).
        await tx.accountInvitation.create({
          data: {
            userId: u.id,
            tokenHash,
            expiresAt: new Date(Date.now() + 3600_000),
            invitedById: u.id,
          },
        });
      }),
    ).rejects.toBeDefined();
    // User KHÔNG được ghi (tx đã rollback toàn bộ).
    const leaked = await prisma.user.findUnique({ where: { email } });
    expect(leaked).toBeNull();
  });

  it('xoá user → cascade xoá invitation/reset/refresh', async () => {
    const user = await createActiveUser(uniq('cascade'));
    await prisma.accountInvitation.create({
      data: {
        userId: user.id,
        tokenHash: generateOpaqueToken().tokenHash,
        expiresAt: new Date(Date.now() + 3600_000),
        invitedById: user.id,
      },
    });
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: generateOpaqueToken().tokenHash,
        expiresAt: new Date(Date.now() + 1200_000),
      },
    });
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: 'refresh-hash',
        expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
      },
    });
    await prisma.user.delete({ where: { id: user.id } });
    expect(
      await prisma.accountInvitation.count({ where: { userId: user.id } }),
    ).toBe(0);
    expect(
      await prisma.passwordResetToken.count({ where: { userId: user.id } }),
    ).toBe(0);
    expect(
      await prisma.refreshToken.count({ where: { userId: user.id } }),
    ).toBe(0);
  });

  it('đặt lại mật khẩu qua API thu hồi refresh token; token cũ bị từ chối', async () => {
    const email = uniq('revoke');
    const user = await createActiveUser(email);

    // Đăng nhập lấy refresh token (ghi DB).
    const login = await request(http)
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    const oldRefresh = (login.body as { data: { refreshToken: string } }).data
      .refreshToken;
    expect(
      await prisma.refreshToken.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBeGreaterThan(0);

    // Đặt lại mật khẩu qua token.
    const { token, tokenHash } = generateOpaqueToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 1200_000),
      },
    });
    await request(http)
      .post('/api/auth/reset-password')
      .send({ token, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })
      .expect(201);

    // Mọi refresh token cũ bị thu hồi.
    expect(
      await prisma.refreshToken.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);

    // Refresh token cũ bị từ chối qua API.
    await request(http)
      .post('/api/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(401);
  });
});
