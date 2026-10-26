import {
  type ExecutionContext,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { Role } from '../../generated/prisma/client';
import { AuthService } from '../auth/auth.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

describe('Cấp/thu hồi một quyền xóa chung toàn CMS', () => {
  let app: INestApplication;
  let actorRole: Role;
  const prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthService, useValue: {} },
        { provide: MailService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<{
            user: { id: string; role: Role };
            headers: Record<string, string>;
          }>();
          req.user = {
            id: 'actor',
            role: (req.headers['x-role'] ?? Role.SUPER_ADMIN) as Role,
          };
          return true;
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
  beforeEach(() => {
    jest.clearAllMocks();
    actorRole = Role.SUPER_ADMIN;
    prisma.user.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === 'actor'
            ? { role: actorRole, isActive: true }
            : { id: 'member', role: Role.ADMIN },
        ),
    );
    prisma.user.update.mockImplementation(({ data }: { data: unknown }) =>
      Promise.resolve(data),
    );
  });
  afterAll(async () => {
    await app.close();
  });

  it.each([true, false])(
    'Super Admin đặt canDeleteCms=%s',
    async (canDeleteCms) => {
      await request(app.getHttpServer() as Server)
        .patch('/users/member/delete-permissions')
        .send({ canDeleteCms })
        .expect(200, { canDeleteCms });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'member' },
          data: { canDeleteCms },
        }),
      );
    },
  );
  it.each([Role.ADMIN, Role.EDITOR])(
    '%s không được cấp quyền kể cả đã có quyền xóa',
    async (role) => {
      await request(app.getHttpServer() as Server)
        .patch('/users/member/delete-permissions')
        .set('x-role', role)
        .send({ canDeleteCms: true })
        .expect(403);
      expect(prisma.user.update).not.toHaveBeenCalled();
    },
  );
  it('JWT cũ mang SUPER_ADMIN không vượt qua vai trò mới trong DB', async () => {
    actorRole = Role.ADMIN;
    await request(app.getHttpServer() as Server)
      .patch('/users/member/delete-permissions')
      .send({ canDeleteCms: true })
      .expect(403);
  });
  it('chỉ nhận boolean; không nhận role hoặc danh sách quyền', async () => {
    for (const body of [
      {},
      { canDeleteCms: 'true' },
      { canDeleteCms: true, role: Role.SUPER_ADMIN },
      { canDeleteCms: true, deletePermissions: ['USERS'] },
    ])
      await request(app.getHttpServer() as Server)
        .patch('/users/member/delete-permissions')
        .send(body)
        .expect(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it('không lén cấp quyền qua cập nhật tài khoản/hồ sơ/lời mời', async () => {
    for (const route of ['/users/member', '/users/me'])
      await request(app.getHttpServer() as Server)
        .patch(route)
        .send({ canDeleteCms: true })
        .expect(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
