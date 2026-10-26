import {
  type ExecutionContext,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

describe('HTTP xác nhận đổi mật khẩu', () => {
  let app: INestApplication;
  const service = {
    requestPasswordChangeCode: jest.fn().mockResolvedValue({
      challengeId: '00000000-0000-4000-8000-000000000001',
    }),
    changePassword: jest.fn().mockResolvedValue({ success: true }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<{
            user: { id: string };
            headers: Record<string, string>;
          }>();
          req.user = { id: 'authenticated-member' };
          return req.headers['x-auth'] === 'yes';
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app.close();
  });
  it('không đăng nhập thì không gửi được mã', async () => {
    await request(app.getHttpServer() as Server)
      .post('/auth/change-password/code')
      .send({ currentPassword: 'old' })
      .expect(403);
    expect(service.requestPasswordChangeCode).not.toHaveBeenCalled();
  });
  it('gửi mã lấy danh tính từ phiên, không nhận email hoặc userId từ client', async () => {
    await request(app.getHttpServer() as Server)
      .post('/auth/change-password/code')
      .set('x-auth', 'yes')
      .send({ currentPassword: 'old' })
      .expect(201);
    expect(service.requestPasswordChangeCode).toHaveBeenCalledWith(
      'authenticated-member',
      'old',
    );
    for (const extra of [{ email: 'other@thienduc.vn' }, { userId: 'other' }])
      await request(app.getHttpServer() as Server)
        .post('/auth/change-password/code')
        .set('x-auth', 'yes')
        .send({ currentPassword: 'old', ...extra })
        .expect(400);
  });
  it('API cũ thiếu mã hoặc gửi mã sai định dạng không thể bỏ qua bước xác nhận', async () => {
    const body = {
      currentPassword: 'old',
      newPassword: 'new-password',
      confirmPassword: 'new-password',
    };
    for (const extra of [
      {},
      { challengeId: 'not-a-uuid', verificationCode: '123456' },
      {
        challengeId: '00000000-0000-4000-8000-000000000001',
        verificationCode: '123',
      },
    ])
      await request(app.getHttpServer() as Server)
        .post('/auth/change-password')
        .set('x-auth', 'yes')
        .send({ ...body, ...extra })
        .expect(400);
    expect(service.changePassword).not.toHaveBeenCalled();
  });
});
