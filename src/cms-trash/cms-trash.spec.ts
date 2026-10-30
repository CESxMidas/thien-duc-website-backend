import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  type ExecutionContext,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CmsTrashService } from './cms-trash.service';
import { CmsTrashController } from './cms-trash.controller';
import { CMS_RECORDS, CmsRecordKind } from './cms-records';
import { BulkDeleteMode } from './bulk-delete-records.dto';

const id = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-000000000002';
const row = {
  id,
  title: { vi: 'Nội dung' },
  name: 'Thành viên',
  deletedAt: null,
  deletedBy: null,
  role: Role.EDITOR,
};
const table = () => ({
  findFirst: jest.fn().mockResolvedValue(row),
  findMany: jest.fn().mockResolvedValue([row]),
  count: jest.fn().mockResolvedValue(1),
  updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
});
const tables = Object.fromEntries(
  Object.values(CMS_RECORDS).map((value) => [value.model, table()]),
);
const user = { ...tables.user, findUnique: jest.fn() };
const prisma = {
  ...tables,
  user,
  refreshToken: { updateMany: jest.fn() },
  accountInvitation: { deleteMany: jest.fn() },
  $transaction: jest.fn(),
};
const service = new CmsTrashService(prisma as unknown as PrismaService);

beforeEach(() => {
  jest.clearAllMocks();
  user.findUnique.mockResolvedValue({
    role: Role.SUPER_ADMIN,
    isActive: true,
    canDeleteCms: false,
  });
  for (const value of Object.values(tables)) {
    value.findFirst.mockResolvedValue(row);
    value.count.mockResolvedValue(1);
  }
  user.findFirst.mockResolvedValue(row);
  user.count.mockResolvedValue(1);
  prisma.$transaction.mockImplementation(
    async (run: (tx: unknown) => Promise<unknown>) => run(prisma),
  );
});

describe('Xóa, thùng rác và khôi phục toàn CMS', () => {
  it.each(Object.values(CmsRecordKind))(
    '%s: xóa nhiều mục vẫn dùng bảo vệ từng bản ghi',
    async (kind) => {
      const ids = [id, '00000000-0000-4000-8000-000000000003'];
      const result = await service.bulkDelete(
        kind,
        { ids, mode: BulkDeleteMode.TRASH },
        actorId,
      );
      expect(result).toEqual({
        succeededIds: ids,
        failed: [],
        remainingIds: [],
      });
      expect(user.findUnique).toHaveBeenCalledTimes(3);
    },
  );

  it('xóa nhiều mục vĩnh viễn bắt buộc xác nhận', async () => {
    await expect(
      service.bulkDelete(
        CmsRecordKind.NEWS,
        { ids: [id], mode: BulkDeleteMode.PERMANENT },
        actorId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tables.newsPost.deleteMany).not.toHaveBeenCalled();
    expect(
      await service.bulkDelete(
        CmsRecordKind.NEWS,
        { ids: [id], mode: BulkDeleteMode.PERMANENT, confirm: true },
        actorId,
      ),
    ).toEqual({ succeededIds: [id], failed: [], remainingIds: [] });
  });

  it('thu hồi quyền giữa lô dừng các mục còn lại và báo đúng phần đã thành công', async () => {
    const active = { role: Role.EDITOR, isActive: true, canDeleteCms: true };
    user.findUnique
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce(active)
      .mockResolvedValue({ ...active, canDeleteCms: false });
    const ids = [id, 'second', 'third'];
    const result = await service.bulkDelete(
      CmsRecordKind.NEWS,
      { ids, mode: BulkDeleteMode.TRASH },
      actorId,
    );
    expect(result.succeededIds).toEqual([id]);
    expect(result.failed).toEqual([
      expect.objectContaining({ id: 'second', status: 403 }),
    ]);
    expect(result.remainingIds).toEqual(['third']);
    expect(tables.newsPost.updateMany).toHaveBeenCalledTimes(1);
  });

  it('xung đột một mục không làm mất kết quả thành công của các mục khác', async () => {
    tables.newsPost.updateMany.mockRejectedValueOnce(
      new ConflictException('Nội dung vừa thay đổi.'),
    );
    const result = await service.bulkDelete(
      CmsRecordKind.NEWS,
      { ids: [id, 'second'], mode: BulkDeleteMode.TRASH },
      actorId,
    );
    expect(result.succeededIds).toEqual(['second']);
    expect(result.failed).toEqual([
      { id, status: 409, message: 'Nội dung vừa thay đổi.' },
    ]);
    expect(result.remainingIds).toEqual([]);
  });

  it('lô tài khoản vẫn chặn xóa chính mình', async () => {
    const result = await service.bulkDelete(
      CmsRecordKind.USERS,
      { ids: [actorId], mode: BulkDeleteMode.TRASH },
      actorId,
    );
    expect(result.succeededIds).toEqual([]);
    expect(result.failed).toEqual([
      expect.objectContaining({ id: actorId, status: 400 }),
    ]);
    expect(user.updateMany).not.toHaveBeenCalled();
  });

  it.each(Object.values(CmsRecordKind))(
    '%s: Super Admin đưa vào thùng rác, không xóa bản ghi',
    async (kind) => {
      await expect(service.trash(kind, id, actorId)).resolves.toEqual({
        trashed: true,
      });
      const delegate =
        kind === CmsRecordKind.USERS ? user : tables[CMS_RECORDS[kind].model];
      expect(delegate.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id, deletedAt: null },
          data: expect.objectContaining({
            deletedBy: actorId,
          }) as unknown,
        }),
      );
      expect(delegate.deleteMany).not.toHaveBeenCalled();
    },
  );

  it.each(Object.values(CmsRecordKind))(
    '%s: Super Admin xóa vĩnh viễn đúng bản ghi',
    async (kind) => {
      await expect(service.purge(kind, id, actorId)).resolves.toEqual({
        deleted: true,
      });
      const delegate =
        kind === CmsRecordKind.USERS ? user : tables[CMS_RECORDS[kind].model];
      expect(delegate.deleteMany).toHaveBeenCalledWith({ where: { id } });
    },
  );

  it.each([Role.ADMIN, Role.EDITOR])(
    '%s mặc định không được xóa/khôi phục/xem thùng rác; cấp một quyền chung có hiệu lực',
    async (role) => {
      user.findUnique.mockResolvedValue({
        role,
        isActive: true,
        canDeleteCms: false,
      });
      await expect(
        service.trash(CmsRecordKind.NEWS, id, actorId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.purge(CmsRecordKind.NEWS, id, actorId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.restore(CmsRecordKind.NEWS, id, actorId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.list(CmsRecordKind.NEWS, actorId, 1),
      ).rejects.toBeInstanceOf(ForbiddenException);
      user.findUnique.mockResolvedValue({
        role,
        isActive: true,
        canDeleteCms: true,
      });
      await expect(
        service.trash(CmsRecordKind.NEWS, id, actorId),
      ).resolves.toEqual({ trashed: true });
      await expect(
        service.purge(CmsRecordKind.BANNERS, id, actorId),
      ).resolves.toEqual({ deleted: true });
    },
  );

  it('thu hồi quyền và khóa tài khoản chặn ngay lần gọi kế tiếp', async () => {
    user.findUnique.mockResolvedValue({
      role: Role.ADMIN,
      isActive: true,
      canDeleteCms: true,
    });
    await service.trash(CmsRecordKind.PAGES, id, actorId);
    user.findUnique.mockResolvedValue({
      role: Role.ADMIN,
      isActive: true,
      canDeleteCms: false,
    });
    await expect(
      service.trash(CmsRecordKind.PAGES, id, actorId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    user.findUnique.mockResolvedValue({
      role: Role.SUPER_ADMIN,
      isActive: false,
      canDeleteCms: true,
    });
    await expect(
      service.purge(CmsRecordKind.PAGES, id, actorId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('khôi phục nội dung xuất bản về nháp, không tái chạy lịch cũ', async () => {
    await service.restore(CmsRecordKind.NEWS, id, actorId);
    expect(tables.newsPost.updateMany).toHaveBeenCalledWith({
      where: { id, deletedAt: { not: null } },
      data: {
        deletedAt: null,
        deletedBy: null,
        status: 'DRAFT',
        scheduledAt: null,
      },
    });
  });

  it('không khôi phục hạng mục/ảnh khi dự án cha chưa được khôi phục', async () => {
    tables.projectItem.findFirst.mockResolvedValue({
      ...row,
      projectId: 'parent',
    });
    tables.project.findFirst.mockResolvedValue(null);
    await expect(
      service.restore(CmsRecordKind.PROJECT_ITEMS, id, actorId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tables.projectItem.updateMany).not.toHaveBeenCalled();
  });

  it('không khôi phục yêu cầu hồ sơ cũ nếu thành viên có yêu cầu chờ duyệt mới', async () => {
    tables.profileChangeRequest.findFirst.mockResolvedValue({
      ...row,
      userId: 'owner',
      status: 'PENDING',
    });
    user.findFirst.mockResolvedValue({ id: 'owner' });
    await expect(
      service.restore(CmsRecordKind.PROFILE_REQUESTS, id, actorId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tables.profileChangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('không xóa chính mình hoặc Super Admin cuối cùng', async () => {
    await expect(
      service.trash(CmsRecordKind.USERS, actorId, actorId),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.purge(CmsRecordKind.USERS, actorId, actorId),
    ).rejects.toBeInstanceOf(BadRequestException);
    user.findFirst.mockResolvedValue({ ...row, role: Role.SUPER_ADMIN });
    user.count.mockResolvedValue(0);
    await expect(
      service.trash(CmsRecordKind.USERS, id, actorId),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.purge(CmsRecordKind.USERS, id, actorId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('người được cấp quyền không xóa/khôi phục Super Admin', async () => {
    user.findUnique.mockResolvedValue({
      role: Role.ADMIN,
      isActive: true,
      canDeleteCms: true,
    });
    user.findFirst.mockResolvedValue({ ...row, role: Role.SUPER_ADMIN });
    await expect(
      service.trash(CmsRecordKind.USERS, id, actorId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.purge(CmsRecordKind.USERS, id, actorId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.restore(CmsRecordKind.USERS, id, actorId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('thùng rác tài khoản chỉ select dữ liệu an toàn và phân trang', async () => {
    await service.list(CmsRecordKind.USERS, actorId, 2);
    expect(user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 30,
        take: 30,
        select: { id: true, name: true, deletedAt: true, deletedBy: true },
      }),
    );
  });
});

describe('Hợp đồng HTTP xóa vĩnh viễn', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CmsTrashController],
      providers: [{ provide: CmsTrashService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<{
            user: { id: string };
            headers: Record<string, string>;
          }>();
          req.user = { id: actorId };
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
  afterAll(async () => {
    await app.close();
  });
  it('không xác thực thì không được gọi', async () => {
    await request(app.getHttpServer() as Server)
      .delete(`/cms-trash/news/${id}`)
      .expect(403);
  });
  it('thiếu xác nhận/false/chuỗi/trường dư đều trả 400 và không xóa', async () => {
    for (const body of [
      {},
      { confirm: false },
      { confirm: 'true' },
      { confirm: true, role: 'SUPER_ADMIN' },
    ])
      await request(app.getHttpServer() as Server)
        .delete(`/cms-trash/news/${id}/permanent`)
        .set('x-auth', 'yes')
        .send(body)
        .expect(400);
    expect(tables.newsPost.deleteMany).not.toHaveBeenCalled();
  });
  it('xác nhận hợp lệ và có quyền mới xóa', async () => {
    await request(app.getHttpServer() as Server)
      .delete(`/cms-trash/news/${id}/permanent`)
      .set('x-auth', 'yes')
      .send({ confirm: true })
      .expect(200, { deleted: true });
  });
  it('bulk API từ chối thiếu xác thực hoặc quyền, không xóa mục nào', async () => {
    const route = '/cms-trash/news/bulk-delete';
    await request(app.getHttpServer() as Server)
      .post(route)
      .send({ ids: [id], mode: 'trash' })
      .expect(403);
    user.findUnique.mockResolvedValue({
      role: Role.ADMIN,
      isActive: true,
      canDeleteCms: false,
    });
    await request(app.getHttpServer() as Server)
      .post(route)
      .set('x-auth', 'yes')
      .send({ ids: [id], mode: 'trash' })
      .expect(403);
    expect(tables.newsPost.updateMany).not.toHaveBeenCalled();
  });

  it('bulk API kiểm UUID, trùng ID, giới hạn lô, phương thức và xác nhận', async () => {
    const route = '/cms-trash/news/bulk-delete';
    for (const body of [
      { ids: [], mode: 'trash' },
      { ids: [id, id], mode: 'trash' },
      { ids: ['bad'], mode: 'trash' },
      { ids: [id], mode: 'invalid' },
      { ids: [id], mode: 'permanent' },
      { ids: [id], mode: 'permanent', confirm: false },
      { ids: [id], mode: 'trash', role: 'SUPER_ADMIN' },
      {
        ids: Array.from(
          { length: 101 },
          (_, index) =>
            `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        ),
        mode: 'trash',
      },
    ]) {
      await request(app.getHttpServer() as Server)
        .post(route)
        .set('x-auth', 'yes')
        .send(body)
        .expect(400);
    }
    expect(tables.newsPost.updateMany).not.toHaveBeenCalled();
    expect(tables.newsPost.deleteMany).not.toHaveBeenCalled();
    await request(app.getHttpServer() as Server)
      .post(route)
      .set('x-auth', 'yes')
      .send({ ids: [id], mode: 'trash' })
      .expect(200, { succeededIds: [id], failed: [], remainingIds: [] });
  });

  it('chặn loại nội dung/UUID/trang sai', async () => {
    await request(app.getHttpServer() as Server)
      .delete(`/cms-trash/unknown/${id}`)
      .set('x-auth', 'yes')
      .expect(400);
    await request(app.getHttpServer() as Server)
      .delete('/cms-trash/news/bad-id')
      .set('x-auth', 'yes')
      .expect(400);
    await request(app.getHttpServer() as Server)
      .get('/cms-trash/news?page=-1')
      .set('x-auth', 'yes')
      .expect(400);
  });
});
