import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, Role } from '../../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { reorderContent } from './content-order';
import { ROLES_KEY } from './decorators/roles.decorator';
import { ProjectsController } from '../projects/projects.controller';
import { NewsController } from '../news/news.controller';
import { RecruitmentPositionsController } from '../recruitment-positions/recruitment-positions.controller';

describe('Thứ tự nội dung', () => {
  const table = { findMany: jest.fn(), updateMany: jest.fn() };
  const transaction = jest.fn();
  const prisma = { $transaction: transaction } as unknown as PrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    table.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    table.updateMany.mockResolvedValue({ count: 1 });
    transaction.mockImplementation((run: (tx: object) => Promise<void>) =>
      run({ newsPost: table, projectItem: table }),
    );
  });

  it('ghi toàn bộ thứ tự trong một transaction Serializable', async () => {
    await expect(
      reorderContent(prisma, 'newsPost', ['b', 'a']),
    ).resolves.toEqual({ reordered: 2 });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(table.updateMany.mock.calls).toEqual([
      [{ where: { id: 'b' }, data: { order: 0 } }],
      [{ where: { id: 'a' }, data: { order: 1 } }],
    ]);
  });

  it.each([[], ['a', 'a']])(
    'từ chối danh sách rỗng/trùng trước khi ghi: %j',
    async (...ids) => {
      await expect(
        reorderContent(prisma, 'newsPost', ids as string[]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it.each([['a'], ['a', 'missing']])(
    'không ghi khi thiếu ID hoặc có ID lạ: %j',
    async (...ids) => {
      await expect(
        reorderContent(prisma, 'newsPost', ids as string[]),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(table.updateMany).not.toHaveBeenCalled();
    },
  );

  it('giới hạn cả kiểm tra lẫn ghi hạng mục trong dự án cha', async () => {
    await reorderContent(prisma, 'projectItem', ['b', 'a'], {
      projectId: 'parent',
    });
    expect(table.findMany).toHaveBeenCalledWith({
      where: { projectId: 'parent' },
      select: { id: true },
    });
    expect(table.updateMany).toHaveBeenCalledWith({
      where: { id: 'b', projectId: 'parent' },
      data: { order: 0 },
    });
  });

  it('trả 409 khi hai thao tác ghi xung đột, không che lỗi thành 500', async () => {
    transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('conflict', {
        code: 'P2034',
        clientVersion: '7',
      }),
    );
    await expect(
      reorderContent(prisma, 'newsPost', ['b', 'a']),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    [ProjectsController.prototype, 'reorder'],
    [ProjectsController.prototype, 'reorderItems'],
    [NewsController.prototype, 'reorder'],
    [RecruitmentPositionsController.prototype, 'reorder'],
  ])('chốt quyền đổi thứ tự ở ADMIN/SUPER_ADMIN', (prototype, method) => {
    const handler = Object.getOwnPropertyDescriptor(prototype, method)
      ?.value as object;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
      Role.ADMIN,
      Role.SUPER_ADMIN,
    ]);
  });
});
