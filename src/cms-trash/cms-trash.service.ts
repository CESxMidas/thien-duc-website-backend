import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContentStatus, Prisma, Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CMS_RECORDS, CmsRecordKind } from './cms-records';

type RecordRow = {
  id: string;
  deletedAt: Date | null;
  deletedBy: string | null;
  projectId?: string;
  projectItemId?: string | null;
  role?: Role;
  [key: string]: unknown;
};
type Delegate = {
  findMany(args: object): Promise<RecordRow[]>;
  findFirst(args: object): Promise<RecordRow | null>;
  count(args: object): Promise<number>;
  updateMany(args: object): Promise<{ count: number }>;
  deleteMany(args: object): Promise<{ count: number }>;
};

@Injectable()
export class CmsTrashService {
  constructor(private readonly prisma: PrismaService) {}

  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(work, options);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(
          'Nội dung hoặc quyền vừa thay đổi. Vui lòng tải lại và thử lại.',
        );
      }
      throw error;
    }
  }

  private async authorize(actorId: string) {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId, deletedAt: null },
      select: { role: true, isActive: true, canDeleteCms: true },
    });
    if (
      !actor?.isActive ||
      (actor.role !== Role.SUPER_ADMIN && !actor.canDeleteCms)
    ) {
      throw new ForbiddenException(
        'Chỉ Super Admin hoặc thành viên được cấp quyền mới được xóa và khôi phục mục này.',
      );
    }
    return actor;
  }

  private delegate(
    client: Prisma.TransactionClient,
    kind: CmsRecordKind,
  ): Delegate {
    return client[CMS_RECORDS[kind].model] as unknown as Delegate;
  }

  async list(kind: CmsRecordKind, actorId: string, page: number) {
    await this.authorize(actorId);
    if (page < 1 || !Number.isSafeInteger(page))
      throw new BadRequestException('Trang không hợp lệ.');
    const table = this.delegate(this.prisma, kind);
    const where = { deletedAt: { not: null } };
    const title = CMS_RECORDS[kind].title;
    const [rows, total] = await Promise.all([
      table.findMany({
        where,
        orderBy: [{ deletedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * 30,
        take: 30,
        select: { id: true, [title]: true, deletedAt: true, deletedBy: true },
      }),
      table.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row[title],
        deletedAt: row.deletedAt,
        deletedBy: row.deletedBy,
      })),
      total,
      page,
      pageSize: 30,
    };
  }

  async trash(kind: CmsRecordKind, id: string, actorId: string) {
    const actor = await this.authorize(actorId);
    return this.transaction(
      async (tx) => {
        const table = this.delegate(tx, kind);
        const row = await table.findFirst({ where: { id, deletedAt: null } });
        if (!row)
          throw new NotFoundException(
            'Không tìm thấy nội dung hoặc nội dung đã nằm trong thùng rác.',
          );
        if (kind === CmsRecordKind.USERS) {
          if (id === actorId)
            throw new BadRequestException(
              'Không thể xóa tài khoản của chính mình.',
            );
          if (row.role === Role.SUPER_ADMIN) {
            if (actor.role !== Role.SUPER_ADMIN)
              throw new ForbiddenException(
                'Thành viên được cấp quyền không được xóa Super Admin.',
              );
            const remaining = await tx.user.count({
              where: {
                id: { not: id },
                role: Role.SUPER_ADMIN,
                isActive: true,
                deletedAt: null,
              },
            });
            if (!remaining)
              throw new BadRequestException(
                'Không thể xóa Super Admin cuối cùng.',
              );
          }
          await tx.refreshToken.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        const data: Record<string, unknown> = {
          deletedAt: new Date(),
          deletedBy: actorId,
        };
        // Khôi phục phải được kiểm tra lại trước khi công khai; lịch cũ không tự chạy.
        if ([CmsRecordKind.PROJECTS, CmsRecordKind.COOPERATION].includes(kind))
          Object.assign(data, {
            contentStatus: ContentStatus.DRAFT,
            scheduledAt: null,
          });
        if ([CmsRecordKind.NEWS, CmsRecordKind.PAGES].includes(kind))
          Object.assign(data, {
            status: ContentStatus.DRAFT,
            scheduledAt: null,
          });
        if (kind === CmsRecordKind.RECRUITMENT)
          data.status = ContentStatus.DRAFT;
        if (
          [
            CmsRecordKind.BANNERS,
            CmsRecordKind.MEDIA,
            CmsRecordKind.NEWS_CATEGORIES,
            CmsRecordKind.USERS,
          ].includes(kind)
        )
          data.isActive = false;
        const result = await table.updateMany({
          where: { id, deletedAt: null },
          data,
        });
        if (!result.count)
          throw new ConflictException(
            'Nội dung vừa được thay đổi. Vui lòng tải lại danh sách.',
          );
        return { trashed: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async restore(kind: CmsRecordKind, id: string, actorId: string) {
    const actor = await this.authorize(actorId);
    return this.transaction(async (tx) => {
      const table = this.delegate(tx, kind);
      const row = await table.findFirst({
        where: { id, deletedAt: { not: null } },
      });
      if (!row)
        throw new NotFoundException('Không tìm thấy nội dung trong thùng rác.');
      if (
        kind === CmsRecordKind.USERS &&
        row.role === Role.SUPER_ADMIN &&
        actor.role !== Role.SUPER_ADMIN
      )
        throw new ForbiddenException(
          'Chỉ Super Admin được khôi phục tài khoản Super Admin.',
        );
      if (row.projectId) {
        const parent = await tx.project.findFirst({
          where: { id: row.projectId, deletedAt: null },
          select: { id: true },
        });
        if (!parent)
          throw new ConflictException('Hãy khôi phục dự án cha trước.');
      }
      if (
        kind === CmsRecordKind.PROFILE_REQUESTS &&
        typeof row.userId === 'string'
      ) {
        const owner = await tx.user.findFirst({
          where: { id: row.userId, deletedAt: null },
          select: { id: true },
        });
        if (!owner)
          throw new ConflictException(
            'Hãy khôi phục tài khoản chủ hồ sơ trước.',
          );
        if (row.status === 'PENDING') {
          const pending = await tx.profileChangeRequest.findFirst({
            where: {
              userId: row.userId,
              id: { not: id },
              status: 'PENDING',
              deletedAt: null,
            },
            select: { id: true },
          });
          if (pending)
            throw new ConflictException(
              'Thành viên đã có yêu cầu chờ duyệt mới. Hãy xử lý yêu cầu mới trước.',
            );
        }
      }
      if (row.projectItemId) {
        const item = await tx.projectItem.findFirst({
          where: { id: row.projectItemId, deletedAt: null },
          select: { id: true },
        });
        if (!item)
          throw new ConflictException('Hãy khôi phục hạng mục cha trước.');
      }
      const data: Record<string, unknown> = {
        deletedAt: null,
        deletedBy: null,
      };
      if ([CmsRecordKind.PROJECTS, CmsRecordKind.COOPERATION].includes(kind))
        Object.assign(data, {
          contentStatus: ContentStatus.DRAFT,
          scheduledAt: null,
        });
      if ([CmsRecordKind.NEWS, CmsRecordKind.PAGES].includes(kind))
        Object.assign(data, { status: ContentStatus.DRAFT, scheduledAt: null });
      if (kind === CmsRecordKind.RECRUITMENT) data.status = ContentStatus.DRAFT;
      if (
        [
          CmsRecordKind.BANNERS,
          CmsRecordKind.MEDIA,
          CmsRecordKind.NEWS_CATEGORIES,
          CmsRecordKind.USERS,
        ].includes(kind)
      )
        data.isActive = false;
      const result = await table.updateMany({
        where: { id, deletedAt: { not: null } },
        data,
      });
      if (!result.count)
        throw new ConflictException(
          'Nội dung đã được khôi phục. Vui lòng tải lại danh sách.',
        );
      return { restored: true };
    });
  }

  async purge(kind: CmsRecordKind, id: string, actorId: string) {
    const actor = await this.authorize(actorId);
    return this.transaction(
      async (tx) => {
        const table = this.delegate(tx, kind);
        const row = await table.findFirst({ where: { id } });
        if (!row) throw new NotFoundException('Không tìm thấy nội dung.');
        if (kind === CmsRecordKind.USERS) {
          if (id === actorId)
            throw new BadRequestException(
              'Không thể xóa tài khoản của chính mình.',
            );
          if (row.role === Role.SUPER_ADMIN) {
            if (actor.role !== Role.SUPER_ADMIN)
              throw new ForbiddenException(
                'Thành viên được cấp quyền không được xóa Super Admin.',
              );
            const remaining = await tx.user.count({
              where: {
                id: { not: id },
                role: Role.SUPER_ADMIN,
                isActive: true,
                deletedAt: null,
              },
            });
            if (!remaining)
              throw new BadRequestException(
                'Không thể xóa Super Admin cuối cùng.',
              );
          }
          // Lời mời do tài khoản tạo ra cũng mất hiệu lực, không chuyển lịch sử sang người khác.
          await tx.accountInvitation.deleteMany({
            where: { OR: [{ userId: id }, { invitedById: id }] },
          });
        }
        const deleted = await table.deleteMany({ where: { id } });
        if (!deleted.count)
          throw new ConflictException(
            'Nội dung đã được xóa. Vui lòng tải lại danh sách.',
          );
        return { deleted: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
