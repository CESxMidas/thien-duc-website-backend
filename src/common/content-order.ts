import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export const CONTENT_ORDER = [
  { order: 'asc' },
  { createdAt: 'desc' },
  { id: 'desc' },
] as const;

type OrderableModel =
  'project' | 'projectItem' | 'newsPost' | 'recruitmentPosition';
type OrderWhere = { id?: string; projectId?: string; deletedAt?: null };
interface OrderableDelegate {
  findMany(args: {
    where: OrderWhere;
    select: { id: true };
  }): Promise<{ id: string }[]>;
  updateMany(args: {
    where: OrderWhere;
    data: { order: number };
  }): Promise<{ count: number }>;
}

/** Kiểm tra và ghi cả danh sách trong cùng transaction; không nhận danh sách đã lọc. */
export async function reorderContent(
  prisma: PrismaService,
  model: OrderableModel,
  ids: string[],
  scope: { projectId?: string } = {},
) {
  if (ids.length === 0 || new Set(ids).size !== ids.length) {
    throw new BadRequestException(
      'Danh sách thứ tự rỗng hoặc có ID trùng lặp.',
    );
  }
  try {
    await prisma.$transaction(
      async (tx) => {
        const table: OrderableDelegate = tx[model];
        const current = await table.findMany({
          where: { ...scope, deletedAt: null },
          select: { id: true },
        });
        const existing = new Set(current.map((item) => item.id));
        if (
          current.length !== ids.length ||
          ids.some((id) => !existing.has(id))
        ) {
          throw new ConflictException(
            'Danh sách đã thay đổi. Hãy tải lại trước khi sắp xếp.',
          );
        }
        for (const [order, id] of ids.entries()) {
          await table.updateMany({ where: { id, ...scope }, data: { order } });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    ) {
      throw new ConflictException(
        'Nội dung vừa thay đổi. Hãy tải lại và thử sắp xếp lần nữa.',
      );
    }
    throw error;
  }
  return { reordered: ids.length };
}
