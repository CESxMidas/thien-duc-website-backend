import {
  BadRequestException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { hashOpaqueToken } from '../common/utils/opaque-token.util';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

jest.mock('bcrypt');
const mockedCompare = bcrypt.compare as jest.MockedFunction<
  (a: string, b: string) => Promise<boolean>
>;
const mockedHash = bcrypt.hash as jest.MockedFunction<
  (data: string, rounds: number) => Promise<string>
>;

/** Tham số đầu tiên của lần gọi mock đầu tiên, có kiểu rõ ràng. */
function firstCallArg<T>(mock: jest.Mock): T {
  return (mock.mock.calls as unknown as T[][])[0][0];
}

/** Tài khoản hợp lệ dùng chung; test nào cần khác thì override từng field. */
const activeUser = {
  id: 'user-1',
  email: 'admin@thienduc.vn',
  passwordHash: 'hashed',
  name: 'Quản trị viên',
  role: 'ADMIN',
  failedLoginAttempts: 0,
  lockedUntil: null as Date | null,
  isActive: true,
};

describe('AuthService', () => {
  let service: AuthService;
  let mailService: { sendPasswordResetEmail: jest.Mock };
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    refreshToken: {
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
    };
    accountInvitation: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    passwordResetToken: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      refreshToken: {
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      accountInvitation: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      passwordResetToken: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    mailService = { sendPasswordResetEmail: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: { sign: () => 'signed.access.token' },
        },
        { provide: ConfigService, useValue: { get: () => 'secret' } },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    jest.clearAllMocks();
    mockedHash.mockResolvedValue('hashed-new-password');
  });

  describe('login', () => {
    it('cấp access + refresh token khi đúng mật khẩu', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      mockedCompare.mockResolvedValue(true);

      const result = await service.login(activeUser.email, 'MatKhau123');

      expect(result.accessToken).toBe('signed.access.token');
      expect(result.refreshToken).toHaveLength(96); // 48 byte -> 96 ký tự hex
      // Refresh token lưu dưới dạng hash, không bao giờ lưu bản rõ.
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
      const created = firstCallArg<{ data: { tokenHash: string } }>(
        prisma.refreshToken.create,
      );
      expect(created.data.tokenHash).not.toBe(result.refreshToken);
    });

    it('reset bộ đếm sai mật khẩu sau khi đăng nhập thành công', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        failedLoginAttempts: 3,
      });
      mockedCompare.mockResolvedValue(true);

      await service.login(activeUser.email, 'MatKhau123');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: activeUser.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    });

    it('báo lỗi chung khi email không tồn tại (không lộ email)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login('la@thienduc.vn', 'x')).rejects.toThrow(
        new UnauthorizedException('Email hoặc mật khẩu không đúng'),
      );
    });

    it('báo lỗi chung khi sai mật khẩu — trùng câu với email không tồn tại', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      mockedCompare.mockResolvedValue(false);

      await expect(service.login(activeUser.email, 'saibet')).rejects.toThrow(
        new UnauthorizedException('Email hoặc mật khẩu không đúng'),
      );
    });

    it('từ chối tài khoản đã bị vô hiệu hóa', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        isActive: false,
      });

      await expect(
        service.login(activeUser.email, 'MatKhau123'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('tăng bộ đếm khi sai mật khẩu, chưa khóa nếu dưới 5 lần', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        failedLoginAttempts: 3,
      });
      mockedCompare.mockResolvedValue(false);

      await expect(service.login(activeUser.email, 'sai')).rejects.toThrow();

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: activeUser.id },
        data: { failedLoginAttempts: 4, lockedUntil: null },
      });
    });

    it('khóa tài khoản ở lần sai thứ 5', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        failedLoginAttempts: 4,
      });
      mockedCompare.mockResolvedValue(false);

      await expect(service.login(activeUser.email, 'sai')).rejects.toThrow();

      const update = firstCallArg<{
        data: { failedLoginAttempts: number; lockedUntil: Date | null };
      }>(prisma.user.update);
      expect(update.data.failedLoginAttempts).toBe(0);
      expect(update.data.lockedUntil).toBeInstanceOf(Date);
      // Khóa 15 phút kể từ bây giờ.
      const minutes =
        (update.data.lockedUntil!.getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(14);
      expect(minutes).toBeLessThanOrEqual(15);
    });

    it('trả 423 Locked khi tài khoản đang bị khóa, không thử so mật khẩu', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        lockedUntil: new Date(Date.now() + 5 * 60_000),
      });

      await expect(
        service.login(activeUser.email, 'MatKhau123'),
      ).rejects.toMatchObject({ status: HttpStatus.LOCKED });
      expect(mockedCompare).not.toHaveBeenCalled();
    });

    it('cho đăng nhập lại sau khi hết hạn khóa', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        lockedUntil: new Date(Date.now() - 60_000), // đã hết hạn
      });
      mockedCompare.mockResolvedValue(true);

      await expect(
        service.login(activeUser.email, 'MatKhau123'),
      ).resolves.toHaveProperty('accessToken');
    });

    // CMS-ACCOUNT-INVITATION-PHASE2B: chặn đăng nhập tài khoản chờ thiết lập.
    describe('cổng chặn tài khoản chờ thiết lập (setupCompletedAt = null)', () => {
      const pendingUser = {
        ...activeUser,
        setupCompletedAt: null as Date | null,
      };

      it('từ chối đăng nhập khi setupCompletedAt = null', async () => {
        prisma.user.findUnique.mockResolvedValue(pendingUser);

        await expect(service.login(pendingUser.email, 'batky')).rejects.toThrow(
          new UnauthorizedException('Tài khoản chưa hoàn tất thiết lập.'),
        );
      });

      it('KHÔNG so mật khẩu với placeholder hash cho tài khoản chờ thiết lập', async () => {
        prisma.user.findUnique.mockResolvedValue(pendingUser);

        await expect(
          service.login(pendingUser.email, 'batky'),
        ).rejects.toThrow();
        expect(mockedCompare).not.toHaveBeenCalled();
      });

      it('KHÔNG tăng failedLoginAttempts / đổi lockedUntil cho tài khoản chờ thiết lập', async () => {
        prisma.user.findUnique.mockResolvedValue(pendingUser);

        await expect(
          service.login(pendingUser.email, 'batky'),
        ).rejects.toThrow();
        expect(prisma.user.update).not.toHaveBeenCalled();
      });

      it('KHÔNG cấp token cho tài khoản chờ thiết lập', async () => {
        prisma.user.findUnique.mockResolvedValue(pendingUser);

        await expect(
          service.login(pendingUser.email, 'batky'),
        ).rejects.toThrow();
        expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      });

      it('tài khoản đã thiết lập (setupCompletedAt != null) vẫn đăng nhập bình thường', async () => {
        prisma.user.findUnique.mockResolvedValue({
          ...activeUser,
          setupCompletedAt: new Date(),
        });
        mockedCompare.mockResolvedValue(true);

        await expect(
          service.login(activeUser.email, 'MatKhau123'),
        ).resolves.toHaveProperty('accessToken');
        expect(mockedCompare).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('refresh', () => {
    it('xoay vòng: thu hồi token cũ và cấp cặp token mới', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        user: activeUser,
      });

      const result = await service.refresh('token-cu');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revokedAt: expect.any(Date) as Date },
      });
      expect(result.refreshToken).not.toBe('token-cu');
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    it('từ chối refresh token không hợp lệ / đã thu hồi / hết hạn', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue(null);

      await expect(service.refresh('token-bay')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('từ chối gia hạn phiên khi tài khoản đã bị vô hiệu hóa', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        user: { ...activeUser, isActive: false },
      });

      await expect(service.refresh('token-cua-nguoi-bi-khoa')).rejects.toThrow(
        UnauthorizedException,
      );
      // Đồng thời dọn sạch mọi refresh token còn sống của tài khoản đó.
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: activeUser.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('revokeAllTokens', () => {
    it('thu hồi mọi refresh token còn sống của tài khoản', async () => {
      await service.revokeAllTokens('user-1');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
    });
  });

  describe('logout', () => {
    it('thu hồi refresh token đang hoạt động', async () => {
      await service.logout('token-cua-toi');

      const call = firstCallArg<{
        where: { revokedAt: null };
        data: { revokedAt: Date };
      }>(prisma.refreshToken.updateMany);
      expect(call.where.revokedAt).toBeNull();
      expect(call.data.revokedAt).toBeInstanceOf(Date);
    });
  });

  describe('getProfile', () => {
    it('trả hồ sơ không kèm passwordHash', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: activeUser.id,
        email: activeUser.email,
        name: activeUser.name,
        role: activeUser.role,
      });

      const profile = await service.getProfile(activeUser.id);

      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile.name).toBe('Quản trị viên');
    });

    it('báo lỗi khi token còn hạn nhưng user đã bị xóa', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('da-xoa')).rejects.toBeInstanceOf(
        HttpException,
      );
    });
  });

  describe('validateInvitationToken', () => {
    const token = 'raw-invitation-token';

    it('trả valid:true khi lời mời còn hiệu lực và tài khoản đủ điều kiện', async () => {
      prisma.accountInvitation.findFirst.mockResolvedValue({
        user: { isActive: true, setupCompletedAt: null },
      });

      await expect(service.validateInvitationToken(token)).resolves.toEqual({
        valid: true,
      });
      // So khớp bằng hash, không bao giờ truyền token thô vào truy vấn where trực tiếp.
      const call = firstCallArg<{ where: { tokenHash: string } }>(
        prisma.accountInvitation.findFirst,
      );
      expect(call.where.tokenHash).toBe(hashOpaqueToken(token));
    });

    it('trả valid:false khi không tìm thấy lời mời (hết hạn/đã dùng/đã thu hồi)', async () => {
      prisma.accountInvitation.findFirst.mockResolvedValue(null);
      await expect(service.validateInvitationToken(token)).resolves.toEqual({
        valid: false,
      });
    });

    it('trả valid:false khi tài khoản đã bị vô hiệu hóa', async () => {
      prisma.accountInvitation.findFirst.mockResolvedValue({
        user: { isActive: false, setupCompletedAt: null },
      });
      await expect(service.validateInvitationToken(token)).resolves.toEqual({
        valid: false,
      });
    });

    it('trả valid:false khi tài khoản đã hoàn tất thiết lập', async () => {
      prisma.accountInvitation.findFirst.mockResolvedValue({
        user: { isActive: true, setupCompletedAt: new Date() },
      });
      await expect(service.validateInvitationToken(token)).resolves.toEqual({
        valid: false,
      });
    });

    it('input dị dạng không làm văng lỗi 500 — trả valid:false', async () => {
      prisma.accountInvitation.findFirst.mockRejectedValue(
        new Error('DB lỗi bất ngờ'),
      );
      await expect(service.validateInvitationToken('   ')).resolves.toEqual({
        valid: false,
      });
    });

    it('không lộ email/tên/vai trò/id trong response', async () => {
      prisma.accountInvitation.findFirst.mockResolvedValue({
        user: { isActive: true, setupCompletedAt: null },
      });
      const result = await service.validateInvitationToken(token);
      expect(Object.keys(result)).toEqual(['valid']);
    });
  });

  describe('acceptInvitation', () => {
    const dto = {
      token: 'raw-invitation-token',
      newPassword: 'MatKhauMoi123',
      confirmPassword: 'MatKhauMoi123',
    };
    const invitationRow = { id: 'inv-1', userId: 'user-pending' };
    const pendingUser = {
      id: 'user-pending',
      isActive: true,
      setupCompletedAt: null,
    };

    it('từ chối khi confirmPassword không khớp — không đụng DB', async () => {
      await expect(
        service.acceptInvitation({ ...dto, confirmPassword: 'khac' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('happy path: đặt mật khẩu, setupCompletedAt, đánh dấu usedAt, thu hồi lời mời khác', async () => {
      prisma.accountInvitation.updateMany.mockResolvedValueOnce({ count: 1 }); // claim thành công
      prisma.accountInvitation.findUniqueOrThrow.mockResolvedValue(
        invitationRow,
      );
      prisma.user.findUnique.mockResolvedValue(pendingUser);
      prisma.user.update.mockResolvedValue({});
      prisma.accountInvitation.updateMany.mockResolvedValueOnce({ count: 0 }); // revoke lời mời khác

      const result = await service.acceptInvitation(dto);

      expect(result).toEqual({ success: true, loginRequired: true });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: pendingUser.id },
        data: {
          passwordHash: 'hashed-new-password',
          setupCompletedAt: expect.any(Date) as Date,
        },
      });
    });

    it('token hết hạn/đã dùng/đã thu hồi -> lỗi chung, không phân biệt lý do', async () => {
      prisma.accountInvitation.updateMany.mockResolvedValueOnce({ count: 0 }); // claim thất bại

      await expect(service.acceptInvitation(dto)).rejects.toThrow(
        'Link thiết lập tài khoản không hợp lệ hoặc đã hết hạn.',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('tài khoản đã bị vô hiệu hóa -> lỗi chung (không lộ lý do)', async () => {
      prisma.accountInvitation.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.accountInvitation.findUniqueOrThrow.mockResolvedValue(
        invitationRow,
      );
      prisma.user.findUnique.mockResolvedValue({
        ...pendingUser,
        isActive: false,
      });

      await expect(service.acceptInvitation(dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('tài khoản đã hoàn tất thiết lập -> lỗi chung (chặn dùng lại link cũ)', async () => {
      prisma.accountInvitation.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.accountInvitation.findUniqueOrThrow.mockResolvedValue(
        invitationRow,
      );
      prisma.user.findUnique.mockResolvedValue({
        ...pendingUser,
        setupCompletedAt: new Date(),
      });

      await expect(service.acceptInvitation(dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('không tạo phiên đăng nhập (không gọi issueTokens/refreshToken.create)', async () => {
      prisma.accountInvitation.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.accountInvitation.findUniqueOrThrow.mockResolvedValue(
        invitationRow,
      );
      prisma.user.findUnique.mockResolvedValue(pendingUser);
      prisma.user.update.mockResolvedValue({});
      prisma.accountInvitation.updateMany.mockResolvedValueOnce({ count: 0 });

      await service.acceptInvitation(dto);

      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  // CMS-AUTH-FORGOT-PASSWORD-PHASE1-BACKEND-M1.
  describe('forgotPassword', () => {
    const NEUTRAL = {
      success: true,
      message:
        'Nếu email tồn tại trong hệ thống, hướng dẫn đặt lại mật khẩu đã được gửi.',
    };
    const eligibleUser = {
      id: 'user-1',
      email: 'admin@thienduc.vn',
      name: 'Quản trị viên',
      isActive: true,
      setupCompletedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    function armIssue() {
      // Không dính cooldown (chưa có token nào trước đó).
      prisma.passwordResetToken.findFirst.mockResolvedValue(null);
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.passwordResetToken.create.mockResolvedValue({
        id: 'prt-1',
        expiresAt: new Date(Date.now() + 20 * 60_000),
      });
    }

    it('email không tồn tại → trả trung tính, không tạo token, không gửi mail', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.forgotPassword('la@thienduc.vn')).resolves.toEqual(
        NEUTRAL,
      );
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('tài khoản bị vô hiệu hóa → trung tính, không gửi mail', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...eligibleUser,
        isActive: false,
      });

      await expect(service.forgotPassword(eligibleUser.email)).resolves.toEqual(
        NEUTRAL,
      );
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('tài khoản chờ thiết lập (setupCompletedAt = null) → trung tính, không gửi mail', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...eligibleUser,
        setupCompletedAt: null,
      });

      await expect(service.forgotPassword(eligibleUser.email)).resolves.toEqual(
        NEUTRAL,
      );
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('tài khoản hợp lệ → tạo token và gửi mail; chỉ lưu tokenHash, không lưu token thô', async () => {
      prisma.user.findUnique.mockResolvedValue(eligibleUser);
      armIssue();

      const result = await service.forgotPassword(eligibleUser.email);

      expect(result).toEqual(NEUTRAL);
      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
      const created = firstCallArg<{
        data: { tokenHash: string; userId: string };
      }>(prisma.passwordResetToken.create);
      // Chỉ có tokenHash trong data — không có field token thô nào.
      expect(created.data.tokenHash).toEqual(expect.any(String));
      expect(created.data).not.toHaveProperty('token');
      expect(mailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    });

    it('thu hồi token còn hiệu lực trước đó khi tạo yêu cầu mới', async () => {
      prisma.user.findUnique.mockResolvedValue(eligibleUser);
      armIssue();

      await service.forgotPassword(eligibleUser.email);

      // updateMany revoke các token còn sống trước khi tạo token mới.
      const revoke = firstCallArg<{
        where: { userId: string; usedAt: null; revokedAt: null };
        data: { revokedAt: Date };
      }>(prisma.passwordResetToken.updateMany);
      expect(revoke.where.userId).toBe(eligibleUser.id);
      expect(revoke.where.usedAt).toBeNull();
      expect(revoke.where.revokedAt).toBeNull();
      expect(revoke.data.revokedAt).toBeInstanceOf(Date);
    });

    it('cooldown 60 giây: yêu cầu mới bị chặn, vẫn trả trung tính', async () => {
      prisma.user.findUnique.mockResolvedValue(eligibleUser);
      // Token gần nhất vừa tạo cách đây 10 giây → còn trong cooldown.
      prisma.passwordResetToken.findFirst.mockResolvedValue({
        createdAt: new Date(Date.now() - 10_000),
      });

      await expect(service.forgotPassword(eligibleUser.email)).resolves.toEqual(
        NEUTRAL,
      );
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('token bản rõ gửi cho mail KHÁC tokenHash lưu DB', async () => {
      prisma.user.findUnique.mockResolvedValue(eligibleUser);
      armIssue();

      await service.forgotPassword(eligibleUser.email);

      const created = firstCallArg<{ data: { tokenHash: string } }>(
        prisma.passwordResetToken.create,
      );
      const mailArg = firstCallArg<{ token: string }>(
        mailService.sendPasswordResetEmail,
      );
      expect(mailArg.token).not.toBe(created.data.tokenHash);
      // tokenHash lưu DB đúng là hash của token bản rõ gửi mail.
      expect(created.data.tokenHash).toBe(hashOpaqueToken(mailArg.token));
    });

    it('mail lỗi (MailService không ném) không phá vỡ response trung tính', async () => {
      prisma.user.findUnique.mockResolvedValue(eligibleUser);
      armIssue();
      // MailService theo quy ước no-throw; ngay cả khi trả về resolve.
      mailService.sendPasswordResetEmail.mockResolvedValue(undefined);

      await expect(service.forgotPassword(eligibleUser.email)).resolves.toEqual(
        NEUTRAL,
      );
    });
  });

  describe('validatePasswordReset', () => {
    const token = 'raw-reset-token';

    it('trả valid:true khi token còn hiệu lực và tài khoản đủ điều kiện', async () => {
      prisma.passwordResetToken.findFirst.mockResolvedValue({
        user: { isActive: true, setupCompletedAt: new Date() },
      });

      await expect(service.validatePasswordReset(token)).resolves.toEqual({
        valid: true,
      });
      // So khớp bằng hash, không truyền token thô vào where.
      const call = firstCallArg<{ where: { tokenHash: string } }>(
        prisma.passwordResetToken.findFirst,
      );
      expect(call.where.tokenHash).toBe(hashOpaqueToken(token));
    });

    it('trả valid:false khi không tìm thấy token (hết hạn/đã dùng/đã thu hồi)', async () => {
      prisma.passwordResetToken.findFirst.mockResolvedValue(null);
      await expect(service.validatePasswordReset(token)).resolves.toEqual({
        valid: false,
      });
    });

    it('trả valid:false khi tài khoản đã bị vô hiệu hóa', async () => {
      prisma.passwordResetToken.findFirst.mockResolvedValue({
        user: { isActive: false, setupCompletedAt: new Date() },
      });
      await expect(service.validatePasswordReset(token)).resolves.toEqual({
        valid: false,
      });
    });

    it('trả valid:false khi tài khoản còn chờ thiết lập (setupCompletedAt = null)', async () => {
      prisma.passwordResetToken.findFirst.mockResolvedValue({
        user: { isActive: true, setupCompletedAt: null },
      });
      await expect(service.validatePasswordReset(token)).resolves.toEqual({
        valid: false,
      });
    });

    it('input dị dạng / lỗi tra cứu không văng 500 — trả valid:false', async () => {
      prisma.passwordResetToken.findFirst.mockRejectedValue(
        new Error('DB lỗi bất ngờ'),
      );
      await expect(service.validatePasswordReset('   ')).resolves.toEqual({
        valid: false,
      });
    });

    it('không lộ email/tên/vai trò/id trong response', async () => {
      prisma.passwordResetToken.findFirst.mockResolvedValue({
        user: { isActive: true, setupCompletedAt: new Date() },
      });
      const result = await service.validatePasswordReset(token);
      expect(Object.keys(result)).toEqual(['valid']);
    });
  });

  describe('resetPassword', () => {
    const dto = {
      token: 'raw-reset-token',
      newPassword: 'MatKhauMoi123',
      confirmPassword: 'MatKhauMoi123',
    };
    const tokenRow = { id: 'prt-1', userId: 'user-1' };
    const eligibleUser = {
      id: 'user-1',
      isActive: true,
      setupCompletedAt: new Date('2026-01-01T00:00:00.000Z'),
      role: 'ADMIN',
      email: 'admin@thienduc.vn',
      lockedUntil: null as Date | null,
    };

    /** Sắp mock cho nhánh happy path (claim thành công + token/user hợp lệ). */
    function armHappyPath() {
      prisma.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 1 }); // claim
      prisma.passwordResetToken.findUniqueOrThrow.mockResolvedValue(tokenRow);
      prisma.user.findUnique.mockResolvedValue(eligibleUser);
      prisma.user.update.mockResolvedValue({});
      prisma.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 0 }); // revoke khác
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 }); // thu hồi phiên
    }

    it('từ chối khi confirmPassword không khớp — không đụng DB', async () => {
      await expect(
        service.resetPassword({ ...dto, confirmPassword: 'khac' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('happy path: cập nhật passwordHash, đánh dấu usedAt, thu hồi mọi refresh token', async () => {
      armHappyPath();

      const result = await service.resetPassword(dto);

      expect(result).toEqual({
        success: true,
        message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.',
      });
      // Cập nhật DUY NHẤT passwordHash.
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: eligibleUser.id },
        data: { passwordHash: 'hashed-new-password' },
      });
      const updateArg = firstCallArg<{ data: Record<string, unknown> }>(
        prisma.user.update,
      );
      expect(Object.keys(updateArg.data)).toEqual(['passwordHash']);
      // Thu hồi mọi refresh token còn sống của tài khoản.
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: eligibleUser.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
      // Claim đánh dấu usedAt.
      const claim = firstCallArg<{ data: { usedAt: Date } }>(
        prisma.passwordResetToken.updateMany,
      );
      expect(claim.data.usedAt).toBeInstanceOf(Date);
    });

    it('thu hồi các token đặt lại khác của cùng tài khoản', async () => {
      armHappyPath();

      await service.resetPassword(dto);

      const calls = (
        prisma.passwordResetToken.updateMany.mock.calls as unknown[][]
      ).map((c) => c[0] as { where: Record<string, unknown> });
      // Lần updateMany thứ hai = revoke token khác (id ≠ token vừa dùng).
      const revokeOthers = calls.find(
        (c) => (c.where as { id?: unknown }).id !== undefined,
      );
      expect(revokeOthers).toBeDefined();
      expect(revokeOthers!.where).toMatchObject({
        userId: eligibleUser.id,
        usedAt: null,
        revokedAt: null,
      });
    });

    it('không tự đăng nhập (không cấp refresh token mới)', async () => {
      armHappyPath();
      await service.resetPassword(dto);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('token không hợp lệ/hết hạn/đã dùng/đã thu hồi → lỗi chung, không đổi mật khẩu', async () => {
      prisma.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 0 }); // claim fail

      await expect(service.resetPassword(dto)).rejects.toThrow(
        'Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('tài khoản bị vô hiệu hóa → lỗi chung, không đổi mật khẩu', async () => {
      prisma.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.passwordResetToken.findUniqueOrThrow.mockResolvedValue(tokenRow);
      prisma.user.findUnique.mockResolvedValue({
        ...eligibleUser,
        isActive: false,
      });

      await expect(service.resetPassword(dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('tài khoản còn chờ thiết lập → lỗi chung, không đổi mật khẩu', async () => {
      prisma.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.passwordResetToken.findUniqueOrThrow.mockResolvedValue(tokenRow);
      prisma.user.findUnique.mockResolvedValue({
        ...eligibleUser,
        setupCompletedAt: null,
      });

      await expect(service.resetPassword(dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('KHÔNG đổi role/email/setupCompletedAt/lockedUntil — chỉ passwordHash', async () => {
      armHappyPath();

      await service.resetPassword(dto);

      const updateArg = firstCallArg<{ data: Record<string, unknown> }>(
        prisma.user.update,
      );
      expect(updateArg.data).not.toHaveProperty('role');
      expect(updateArg.data).not.toHaveProperty('email');
      expect(updateArg.data).not.toHaveProperty('setupCompletedAt');
      expect(updateArg.data).not.toHaveProperty('lockedUntil');
      expect(updateArg.data).not.toHaveProperty('isActive');
    });

    it('đồng thời cùng một token: chỉ đúng một request thắng (claim nguyên tử)', async () => {
      // Hai request song song, cùng token. Request đầu claim được (count=1),
      // request sau claim trượt (count=0) vì usedAt đã bị set.
      prisma.passwordResetToken.findUniqueOrThrow.mockResolvedValue(tokenRow);
      prisma.user.findUnique.mockResolvedValue(eligibleUser);
      prisma.user.update.mockResolvedValue({});
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      let claimed = false;
      prisma.passwordResetToken.updateMany.mockImplementation(
        (args: { data: { usedAt?: Date } }) => {
          // Chỉ nhánh claim (set usedAt) mới đua; nhánh revoke-others bỏ qua.
          if (args.data.usedAt === undefined) return { count: 0 };
          if (claimed) return { count: 0 };
          claimed = true;
          return { count: 1 };
        },
      );

      const results = await Promise.allSettled([
        service.resetPassword(dto),
        service.resetPassword(dto),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
    });
  });
});
