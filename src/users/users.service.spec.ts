import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

jest.mock('bcrypt');
(bcrypt.hash as jest.Mock).mockResolvedValue('hashed');

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
  };
  let authService: { revokeAllTokens: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
    };
    authService = { revokeAllTokens: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthService, useValue: authService },
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
