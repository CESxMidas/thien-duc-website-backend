import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TestUsersService } from './test-users.service';

/**
 * An toàn fixture E2E: mọi ghi/xoá chỉ được nhắm domain @e2e.test. Prisma bị mock
 * để test không chạm DB thật.
 */
describe('TestUsersService — chặn cứng domain @e2e.test', () => {
  const upsert = jest.fn();
  const deleteMany = jest.fn();
  const findUnique = jest.fn();
  const prisma = {
    user: { upsert, deleteMany, findUnique },
  } as unknown as PrismaService;
  const service = new TestUsersService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('từ chối email ngoài domain @e2e.test (không đụng seed @test.local)', async () => {
    await expect(
      service.upsert({
        email: 'admin-e2e@test.local',
        role: 'ADMIN',
        isActive: true,
        setupCompleted: true,
        password: 'x'.repeat(10),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('setupCompleted=true nhưng thiếu password → 400, không ghi', async () => {
    await expect(
      service.upsert({
        email: 'active@e2e.test',
        role: 'ADMIN',
        isActive: true,
        setupCompleted: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('deleteAll chỉ xoá theo domain @e2e.test', async () => {
    deleteMany.mockResolvedValue({ count: 3 });
    const count = await service.deleteAll();
    expect(count).toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { email: { endsWith: '@e2e.test' } },
    });
  });

  it('tài khoản pending (@e2e.test): không cần password, setup_completed_at=null', async () => {
    upsert.mockImplementation(
      (args: { create: { setupCompletedAt: Date | null } }) =>
        Promise.resolve({
          id: 'u1',
          email: 'pending@e2e.test',
          role: 'EDITOR',
          isActive: true,
          setupCompletedAt: args.create.setupCompletedAt,
        }),
    );
    const view = await service.upsert({
      email: 'pending@e2e.test',
      role: 'EDITOR',
      isActive: true,
      setupCompleted: false,
    });
    expect(view.setupCompleted).toBe(false);
    const calls = upsert.mock.calls as unknown[][];
    const call = calls[0][0] as { create: { setupCompletedAt: Date | null } };
    expect(call.create.setupCompletedAt).toBeNull();
  });
});
