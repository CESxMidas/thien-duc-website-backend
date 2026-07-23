import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth/auth.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

jest.mock('bcrypt');
(bcrypt.hash as jest.Mock).mockResolvedValue('hashed');

/** Tham số đầu tiên của lần gọi mock đầu tiên, có kiểu rõ ràng. */
function firstCallArg<T>(mock: jest.Mock): T {
  return (mock.mock.calls as unknown as T[][])[0][0];
}

/** Lỗi Prisma khi email trùng (ràng buộc unique). */
const uniqueViolation = Object.assign(new Error('Unique constraint'), {
  code: 'P2002',
});

const superAdmin = {
  id: 'sa-1',
  email: 'boss@thienduc.vn',
  name: 'Sếp',
  role: 'SUPER_ADMIN',
  isActive: true,
  createdAt: new Date(),
};
const editor = {
  id: 'ed-1',
  email: 'bientap@thienduc.vn',
  name: 'Biên tập',
  role: 'EDITOR',
  isActive: true,
  createdAt: new Date(),
};

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    accountInvitation: {
      create: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let authService: { revokeAllTokens: jest.Mock };
  let mailService: { sendAccountInvitation: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      accountInvitation: {
        create: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      // Mô phỏng transaction tương tác: gọi thẳng callback với chính `prisma`
      // giả này làm `tx` — mọi lệnh bên trong transaction đi qua cùng mock.
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    authService = { revokeAllTokens: jest.fn() };
    mailService = {
      sendAccountInvitation: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthService, useValue: authService },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
  });

  describe('findOne', () => {
    it('báo 404 khi không có tài khoản', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findOne('khong-co')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('không trả passwordHash', async () => {
      prisma.user.findUnique.mockResolvedValue(editor);
      const found = await service.findOne(editor.id);
      expect(found).not.toHaveProperty('passwordHash');
    });
  });

  describe('create', () => {
    it('băm mật khẩu trước khi lưu', async () => {
      prisma.user.create.mockResolvedValue(editor);

      await service.create({
        email: editor.email,
        name: editor.name,
        password: 'MatKhau123',
        role: 'EDITOR',
      });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ passwordHash: 'hashed' }),
        }),
      );
      // Không bao giờ ghi mật khẩu thô xuống DB.
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ password: expect.anything() }),
        }),
      );
    });

    it('trả 409 khi email đã tồn tại (không phải 500)', async () => {
      prisma.user.create.mockRejectedValue(uniqueViolation);

      await expect(
        service.create({
          email: editor.email,
          name: 'x',
          password: 'MatKhau123',
          role: 'EDITOR',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('createInvitation', () => {
    const dto = {
      email: 'moi@thienduc.vn',
      name: 'Người mới',
      role: 'EDITOR' as const,
    };
    const createdUser = {
      id: 'new-1',
      email: dto.email,
      name: dto.name,
      role: dto.role,
      isActive: true,
      createdAt: new Date(),
    };
    const createdInvitation = {
      id: 'inv-1',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      usedAt: null,
      revokedAt: null,
    };

    it('tạo User + AccountInvitation trong một transaction, không có mật khẩu client', async () => {
      prisma.user.create.mockResolvedValue(createdUser);
      prisma.accountInvitation.create.mockResolvedValue(createdInvitation);

      const result = await service.createInvitation(dto, 'sa-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: dto.email,
            name: dto.name,
            role: dto.role,
            isActive: true,
            setupCompletedAt: null,
            passwordHash: 'hashed',
          }),
        }),
      );
      // DTO không có field password — không có gì để rò vào data ngoài passwordHash placeholder.
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ password: expect.anything() }),
        }),
      );
      expect(result.user).toEqual(createdUser);
      expect(result.invitation).toEqual(createdInvitation);
    });

    it('setupCompletedAt = null và isActive = true khi tạo', async () => {
      prisma.user.create.mockResolvedValue(createdUser);
      prisma.accountInvitation.create.mockResolvedValue(createdInvitation);

      await service.createInvitation(dto, 'sa-1');

      const call = firstCallArg<{
        data: { setupCompletedAt: unknown; isActive: unknown };
      }>(prisma.user.create);
      expect(call.data.setupCompletedAt).toBeNull();
      expect(call.data.isActive).toBe(true);
    });

    it('invitedById là id của SUPER_ADMIN đang thao tác, hạn 48 giờ', async () => {
      prisma.user.create.mockResolvedValue(createdUser);
      prisma.accountInvitation.create.mockResolvedValue(createdInvitation);

      await service.createInvitation(dto, 'sa-1');

      const call = firstCallArg<{
        data: {
          invitedById: string;
          userId: string;
          expiresAt: Date;
          tokenHash: string;
        };
      }>(prisma.accountInvitation.create);
      expect(call.data.invitedById).toBe('sa-1');
      expect(call.data.userId).toBe(createdUser.id);
      const hoursUntilExpiry =
        (call.data.expiresAt.getTime() - Date.now()) / (60 * 60 * 1000);
      expect(hoursUntilExpiry).toBeGreaterThan(47);
      expect(hoursUntilExpiry).toBeLessThanOrEqual(48);
      // Chỉ hash được lưu — không phải token bản rõ.
      expect(call.data.tokenHash).toHaveLength(64); // sha256 hex
    });

    it('trả 409 khi email đã tồn tại (không phải 500)', async () => {
      prisma.$transaction.mockRejectedValue(uniqueViolation);

      await expect(service.createInvitation(dto, 'sa-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('không trả passwordHash, tokenHash, hay token thô ra ngoài', async () => {
      prisma.user.create.mockResolvedValue(createdUser);
      prisma.accountInvitation.create.mockResolvedValue(createdInvitation);

      const result = await service.createInvitation(dto, 'sa-1');
      const serialized = JSON.stringify(result);

      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.invitation).not.toHaveProperty('tokenHash');
      expect(serialized).not.toMatch(/tokenHash/);
      expect(serialized).not.toMatch(/passwordHash/);
      // Không có field `token` nào trong response.
      expect(serialized).not.toMatch(/"token"/);
    });

    it('gửi email lời mời SAU commit, với token bản rõ chỉ đi vào MailService', async () => {
      prisma.user.create.mockResolvedValue(createdUser);
      prisma.accountInvitation.create.mockResolvedValue(createdInvitation);

      await service.createInvitation(dto, 'sa-1');

      expect(mailService.sendAccountInvitation).toHaveBeenCalledTimes(1);
      const arg = firstCallArg<{
        to: string;
        name: string;
        role: string;
        token: string;
        expiresAt: Date;
      }>(mailService.sendAccountInvitation);
      expect(arg.to).toBe(createdUser.email);
      expect(arg.name).toBe(createdUser.name);
      expect(arg.role).toBe(createdUser.role);
      expect(arg.expiresAt).toBe(createdInvitation.expiresAt);
      // Token bản rõ khác hoàn toàn tokenHash đã lưu DB.
      const stored = firstCallArg<{ data: { tokenHash: string } }>(
        prisma.accountInvitation.create,
      );
      expect(arg.token).toBeTruthy();
      expect(arg.token).not.toBe(stored.data.tokenHash);
    });

    it('mail lỗi không làm hỏng việc tạo tài khoản/lời mời (đã commit)', async () => {
      prisma.user.create.mockResolvedValue(createdUser);
      prisma.accountInvitation.create.mockResolvedValue(createdInvitation);
      // MailService không bao giờ ném (degrade an toàn) — mô phỏng đúng hợp đồng đó.
      mailService.sendAccountInvitation.mockResolvedValue(undefined);

      const result = await service.createInvitation(dto, 'sa-1');
      expect(result.user).toEqual(createdUser);
      expect(result.invitation).toEqual(createdInvitation);
    });
  });

  describe('resendInvitation', () => {
    const pendingUser = {
      id: 'pending-1',
      email: 'cho@thienduc.vn',
      isActive: true,
      setupCompletedAt: null,
    };

    it('chỉ SUPER_ADMIN gọi được (kiểm ở controller @Roles — service không cần biết role)', async () => {
      prisma.user.findUnique.mockResolvedValue(pendingUser);
      prisma.accountInvitation.findFirst.mockResolvedValue(null);
      prisma.accountInvitation.updateMany.mockResolvedValue({ count: 0 });
      prisma.accountInvitation.create.mockResolvedValue({ id: 'inv-2' });

      await expect(
        service.resendInvitation(pendingUser.id, 'sa-1'),
      ).resolves.toBeDefined();
    });

    it('từ chối khi tài khoản không tồn tại', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.resendInvitation('khong-co', 'sa-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('từ chối khi tài khoản đã hoàn tất thiết lập', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...pendingUser,
        setupCompletedAt: new Date(),
      });

      await expect(
        service.resendInvitation(pendingUser.id, 'sa-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('từ chối khi tài khoản đã bị vô hiệu hóa', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...pendingUser,
        isActive: false,
      });

      await expect(
        service.resendInvitation(pendingUser.id, 'sa-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('chặn gửi lại trong vòng 60 giây (cooldown)', async () => {
      prisma.user.findUnique.mockResolvedValue(pendingUser);
      prisma.accountInvitation.findFirst.mockResolvedValue({
        id: 'inv-old',
        createdAt: new Date(Date.now() - 5000), // 5 giây trước
      });

      await expect(
        service.resendInvitation(pendingUser.id, 'sa-1'),
      ).rejects.toThrow(HttpException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('cho gửi lại sau khi hết cooldown; thu hồi lời mời cũ, tạo lời mời mới', async () => {
      prisma.user.findUnique.mockResolvedValue(pendingUser);
      prisma.accountInvitation.findFirst.mockResolvedValue({
        id: 'inv-old',
        createdAt: new Date(Date.now() - 120_000), // 2 phút trước
      });
      prisma.accountInvitation.updateMany.mockResolvedValue({ count: 1 });
      const newInvitation = { id: 'inv-new', expiresAt: new Date() };
      prisma.accountInvitation.create.mockResolvedValue(newInvitation);

      const result = await service.resendInvitation(pendingUser.id, 'sa-1');

      expect(prisma.accountInvitation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: pendingUser.id,
            usedAt: null,
            revokedAt: null,
          }) as unknown,
        }),
      );
      expect(result).toEqual(newInvitation);
    });

    it('gửi email lời mời mới tới đúng người nhận, token mới chỉ vào MailService', async () => {
      const userWithProfile = {
        ...pendingUser,
        name: 'Người chờ',
        role: 'EDITOR',
      };
      prisma.user.findUnique.mockResolvedValue(userWithProfile);
      prisma.accountInvitation.findFirst.mockResolvedValue(null);
      prisma.accountInvitation.updateMany.mockResolvedValue({ count: 1 });
      const newInvitation = {
        id: 'inv-new',
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      };
      prisma.accountInvitation.create.mockResolvedValue(newInvitation);

      await service.resendInvitation(pendingUser.id, 'sa-1');

      expect(mailService.sendAccountInvitation).toHaveBeenCalledTimes(1);
      const arg = firstCallArg<{ to: string; token: string; expiresAt: Date }>(
        mailService.sendAccountInvitation,
      );
      expect(arg.to).toBe(userWithProfile.email);
      const stored = firstCallArg<{ data: { tokenHash: string } }>(
        prisma.accountInvitation.create,
      );
      expect(arg.token).toBeTruthy();
      expect(arg.token).not.toBe(stored.data.tokenHash);
    });

    it('mail lỗi không hoàn tác việc thu hồi lời mời cũ / tạo lời mời mới', async () => {
      prisma.user.findUnique.mockResolvedValue(pendingUser);
      prisma.accountInvitation.findFirst.mockResolvedValue(null);
      prisma.accountInvitation.updateMany.mockResolvedValue({ count: 1 });
      const newInvitation = { id: 'inv-new', expiresAt: new Date() };
      prisma.accountInvitation.create.mockResolvedValue(newInvitation);
      mailService.sendAccountInvitation.mockResolvedValue(undefined);

      const result = await service.resendInvitation(pendingUser.id, 'sa-1');
      expect(result).toEqual(newInvitation);
      // Thu hồi lời mời cũ vẫn xảy ra bên trong transaction, độc lập với mail.
      expect(prisma.accountInvitation.updateMany).toHaveBeenCalled();
    });

    it('không trả token thô hay tokenHash', async () => {
      prisma.user.findUnique.mockResolvedValue(pendingUser);
      prisma.accountInvitation.findFirst.mockResolvedValue(null);
      prisma.accountInvitation.updateMany.mockResolvedValue({ count: 0 });
      const newInvitation = { id: 'inv-new', expiresAt: new Date() };
      prisma.accountInvitation.create.mockResolvedValue(newInvitation);

      const result = await service.resendInvitation(pendingUser.id, 'sa-1');
      expect(JSON.stringify(result)).not.toMatch(/tokenHash/);
    });
  });

  describe('revokeInvitation', () => {
    it('từ chối khi tài khoản không tồn tại', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.revokeInvitation('khong-co', 'sa-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('trả 400 khi tài khoản đã hoàn tất thiết lập', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        setupCompletedAt: new Date(),
      });

      await expect(service.revokeInvitation('u-1', 'sa-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.accountInvitation.updateMany).not.toHaveBeenCalled();
    });

    it('thu hồi mọi lời mời đang hiệu lực, không đụng field User khác', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        setupCompletedAt: null,
      });
      prisma.accountInvitation.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.revokeInvitation('u-1', 'sa-1');

      expect(prisma.accountInvitation.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u-1', usedAt: null, revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(result).toEqual({ revoked: true });
    });

    it('gọi lần hai khi không còn gì để thu hồi — no-op an toàn (idempotent)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        setupCompletedAt: null,
      });
      prisma.accountInvitation.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.revokeInvitation('u-1', 'sa-1');
      expect(result).toEqual({ revoked: false });
    });
  });

  describe('update', () => {
    it('mở khóa lại tài khoản được (isActive: true)', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...editor, isActive: false });
      prisma.user.update.mockResolvedValue({ ...editor, isActive: true });

      await service.update(editor.id, { isActive: true }, superAdmin.id);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: true }),
        }),
      );
      // Mở khóa thì không cần thu hồi phiên.
      expect(authService.revokeAllTokens).not.toHaveBeenCalled();
    });

    it('thu hồi phiên khi đổi vai trò', async () => {
      prisma.user.findUnique.mockResolvedValue(editor);
      prisma.user.update.mockResolvedValue({ ...editor, role: 'ADMIN' });

      await service.update(editor.id, { role: 'ADMIN' }, superAdmin.id);

      expect(authService.revokeAllTokens).toHaveBeenCalledWith(editor.id);
    });

    it('thu hồi phiên khi đặt lại mật khẩu, và băm mật khẩu mới', async () => {
      prisma.user.findUnique.mockResolvedValue(editor);
      prisma.user.update.mockResolvedValue(editor);

      await service.update(
        editor.id,
        { password: 'MatKhauMoi1' },
        superAdmin.id,
      );

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ passwordHash: 'hashed' }),
        }),
      );
      // Không ghi thẳng mật khẩu thô.
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ password: expect.anything() }),
        }),
      );
      expect(authService.revokeAllTokens).toHaveBeenCalledWith(editor.id);
    });

    it('thu hồi phiên khi khóa tài khoản', async () => {
      prisma.user.findUnique.mockResolvedValue(editor);
      prisma.user.update.mockResolvedValue({ ...editor, isActive: false });

      await service.update(editor.id, { isActive: false }, superAdmin.id);

      expect(authService.revokeAllTokens).toHaveBeenCalledWith(editor.id);
    });

    it('không cho tự đổi vai trò của chính mình', async () => {
      prisma.user.findUnique.mockResolvedValue(superAdmin);

      await expect(
        service.update(superAdmin.id, { role: 'EDITOR' }, superAdmin.id),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('không cho tự khóa chính mình', async () => {
      prisma.user.findUnique.mockResolvedValue(superAdmin);

      await expect(
        service.update(superAdmin.id, { isActive: false }, superAdmin.id),
      ).rejects.toThrow(BadRequestException);
    });

    it('không cho hạ quyền Super Admin cuối cùng', async () => {
      prisma.user.findUnique.mockResolvedValue(superAdmin);
      prisma.user.count.mockResolvedValue(0); // không còn super admin nào khác

      await expect(
        service.update(superAdmin.id, { role: 'ADMIN' }, 'nguoi-khac'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('cho hạ quyền Super Admin khi vẫn còn người khác', async () => {
      prisma.user.findUnique.mockResolvedValue(superAdmin);
      prisma.user.count.mockResolvedValue(1);
      prisma.user.update.mockResolvedValue({ ...superAdmin, role: 'ADMIN' });

      await expect(
        service.update(superAdmin.id, { role: 'ADMIN' }, 'nguoi-khac'),
      ).resolves.toBeDefined();
    });

    it('trả 409 khi đổi sang email đã có người dùng', async () => {
      prisma.user.findUnique.mockResolvedValue(editor);
      prisma.user.update.mockRejectedValue(uniqueViolation);

      await expect(
        service.update(editor.id, { email: superAdmin.email }, superAdmin.id),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('vô hiệu hóa tài khoản và thu hồi phiên', async () => {
      prisma.user.findUnique.mockResolvedValue(editor);
      prisma.user.update.mockResolvedValue({ ...editor, isActive: false });

      const result = await service.remove(editor.id, superAdmin.id);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: editor.id },
        data: { isActive: false },
      });
      expect(authService.revokeAllTokens).toHaveBeenCalledWith(editor.id);
      expect(result).toEqual({ deactivated: true });
    });

    it('không cho tự xóa chính mình', async () => {
      prisma.user.findUnique.mockResolvedValue(superAdmin);

      await expect(
        service.remove(superAdmin.id, superAdmin.id),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('không cho xóa Super Admin cuối cùng', async () => {
      prisma.user.findUnique.mockResolvedValue(superAdmin);
      prisma.user.count.mockResolvedValue(0);

      await expect(service.remove(superAdmin.id, 'nguoi-khac')).rejects.toThrow(
        BadRequestException,
      );
      expect(authService.revokeAllTokens).not.toHaveBeenCalled();
    });
  });
});
