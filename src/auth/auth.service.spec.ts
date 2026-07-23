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
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: { sign: () => 'signed.access.token' },
        },
        { provide: ConfigService, useValue: { get: () => 'secret' } },
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
});
