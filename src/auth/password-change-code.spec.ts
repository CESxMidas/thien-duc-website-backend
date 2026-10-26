import {
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn((value: string) =>
    Promise.resolve(value === 'old-password'),
  ),
  hash: jest.fn(() => Promise.resolve('new-hash')),
}));
type CodeRow = {
  id: string;
  userId: string;
  codeHash: string;
  passwordFingerprint: string;
  email: string;
  attempts: number;
  usedAt: Date | null;
  sentAt: Date;
  expiresAt: Date;
};

describe('Mã email bắt buộc trước khi đổi mật khẩu', () => {
  let row: CodeRow | null;
  const user = {
    id: 'member',
    email: 'member@thienduc.vn',
    passwordHash: 'old-hash',
    isActive: true,
    setupCompletedAt: new Date(),
  };
  const mail = { sendPasswordChangeCode: jest.fn() };
  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    passwordChangeCode: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    refreshToken: { updateMany: jest.fn() },
    passwordResetToken: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    {} as JwtService,
    new ConfigService({ JWT_ACCESS_SECRET: 'test-secret-only' }),
    mail as unknown as MailService,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    row = null;
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.user.update.mockResolvedValue({});
    mail.sendPasswordChangeCode.mockResolvedValue(true);
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    );
    prisma.passwordChangeCode.findUnique.mockImplementation(() =>
      Promise.resolve(row),
    );
    prisma.passwordChangeCode.upsert.mockImplementation(
      ({ create }: { create: CodeRow }) => {
        row = { ...create };
        return Promise.resolve(row);
      },
    );
    prisma.passwordChangeCode.updateMany.mockImplementation(
      ({
        where,
        data,
      }: {
        where: {
          id: string;
          userId?: string;
          attempts?: { lt: number };
          usedAt?: null;
          expiresAt?: { gt: Date };
        };
        data: { usedAt?: Date; attempts?: { increment: number } };
      }) => {
        if (
          !row ||
          row.id !== where.id ||
          (where.userId && row.usedAt) ||
          (where.attempts && row.attempts >= where.attempts.lt) ||
          (where.expiresAt && row.expiresAt <= where.expiresAt.gt)
        )
          return Promise.resolve({ count: 0 });
        if (data.usedAt) row.usedAt = data.usedAt;
        if (data.attempts) row.attempts += data.attempts.increment;
        return Promise.resolve({ count: 1 });
      },
    );
  });

  async function issue() {
    const result = await service.requestPasswordChangeCode(
      'member',
      'old-password',
    );
    const [email] = mail.sendPasswordChangeCode.mock.calls[0] as [
      { to: string; code: string },
    ];
    return {
      result,
      code: email.code,
      dto: {
        challengeId: result.challengeId,
        verificationCode: email.code,
        currentPassword: 'old-password',
        newPassword: 'new-password',
        confirmPassword: 'new-password',
      },
    };
  }

  it('gửi mã 6 số tới email lưu trong DB, chỉ lưu HMAC và chưa đổi mật khẩu', async () => {
    const { result, code } = await issue();
    expect(code).toMatch(/^\d{6}$/);
    expect(result.maskedEmail).toBe('m***@thienduc.vn');
    expect(JSON.stringify(result)).not.toContain(code);
    expect(row?.codeHash).not.toBe(code);
    expect(mail.sendPasswordChangeCode).toHaveBeenCalledWith(
      expect.objectContaining({ to: user.email }),
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it('mật khẩu hiện tại sai: không gửi email, không tạo mã', async () => {
    await expect(
      service.requestPasswordChangeCode('member', 'wrong'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mail.sendPasswordChangeCode).not.toHaveBeenCalled();
    expect(prisma.passwordChangeCode.upsert).not.toHaveBeenCalled();
  });
  it('gửi lại trong 60 giây bị chặn theo tài khoản', async () => {
    await issue();
    await expect(
      service.requestPasswordChangeCode('member', 'old-password'),
    ).rejects.toBeInstanceOf(HttpException);
    expect(mail.sendPasswordChangeCode).toHaveBeenCalledTimes(1);
  });
  it('mã mới thay mã cũ; mã cũ không dùng được sau khi gửi lại', async () => {
    const old = await issue();
    row!.sentAt = new Date(Date.now() - 60_001);
    const next = await service.requestPasswordChangeCode(
      'member',
      'old-password',
    );
    expect(next.challengeId).not.toBe(old.result.challengeId);
    await expect(
      service.changePassword('member', old.dto),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it('gửi email lỗi hoặc thiếu cấu hình: báo thất bại, vô hiệu mã', async () => {
    mail.sendPasswordChangeCode.mockResolvedValue(false);
    await expect(
      service.requestPasswordChangeCode('member', 'old-password'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(row!.usedAt).toBeInstanceOf(Date);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it('mã đúng đổi mật khẩu và chỉ dùng được một lần', async () => {
    const { dto } = await issue();
    await service.changePassword('member', dto);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: {
        id: user.id,
        passwordHash: user.passwordHash,
        email: user.email,
        isActive: true,
        deletedAt: null,
      },
      data: { passwordHash: 'new-hash', tokenVersion: { increment: 1 } },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalled();
    await expect(service.changePassword('member', dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });
  it('sai mã 5 lần thì cả mã đúng cũng không dùng được', async () => {
    const { dto, code } = await issue();
    for (let i = 0; i < 5; i++)
      await expect(
        service.changePassword('member', {
          ...dto,
          verificationCode: code === '000000' ? '111111' : '000000',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    expect(row!.attempts).toBe(5);
    await expect(service.changePassword('member', dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it.each(['expired', 'email-changed', 'password-changed', 'other-user'])(
    '%s không đổi được mật khẩu',
    async (scenario) => {
      const { dto } = await issue();
      if (scenario === 'expired') row!.expiresAt = new Date(Date.now() - 1);
      if (scenario === 'email-changed')
        prisma.user.findUnique.mockResolvedValue({
          ...user,
          email: 'new@thienduc.vn',
        });
      if (scenario === 'password-changed')
        prisma.user.findUnique.mockResolvedValue({
          ...user,
          passwordHash: 'different-hash',
        });
      if (scenario === 'other-user')
        prisma.passwordChangeCode.findUnique.mockResolvedValue(null);
      await expect(
        service.changePassword('member', dto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    },
  );
  it('không có mã thì không thể bỏ qua bước xác nhận bằng API trực tiếp', async () => {
    await expect(
      service.changePassword('member', {
        challengeId: 'anything',
        verificationCode: '',
        currentPassword: 'old-password',
        newPassword: 'new-password',
        confirmPassword: 'new-password',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
