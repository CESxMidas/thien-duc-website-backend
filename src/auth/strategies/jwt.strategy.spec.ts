import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('Access token sau khi xóa/khóa hoặc đổi vai trò tài khoản', () => {
  const prisma = { user: { findUnique: jest.fn() } };
  const strategy = new JwtStrategy(
    new ConfigService({
      JWT_ACCESS_SECRET: 'khóa-kiểm-thử-riêng-không-dùng-production-123456789',
    }),
    prisma as unknown as PrismaService,
  );
  const payload = {
    sub: 'member-id',
    email: 'old@thienduc.vn',
    role: 'SUPER_ADMIN',
  };
  beforeEach(() => jest.clearAllMocks());

  it('đọc vai trò hiện tại thay cho quyền Super Admin cũ trong JWT', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: payload.sub,
      email: 'current@thienduc.vn',
      role: Role.EDITOR,
    });
    expect(await strategy.validate(payload)).toEqual({
      id: payload.sub,
      email: 'current@thienduc.vn',
      role: Role.EDITOR,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: payload.sub, deletedAt: null, isActive: true },
      select: { id: true, email: true, role: true },
    });
  });

  it('từ chối ngay token còn hạn nếu tài khoản không còn hoạt động', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
