import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Role } from '../../generated/prisma/client';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SALT_ROUNDS = 12;

/** Các field an toàn để trả ra ngoài — không bao giờ gồm `passwordHash`. */
const PUBLIC_FIELDS = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
} as const;

/**
 * Field bổ sung cho màn hình xem chi tiết một tài khoản (GET /users/:id):
 * thêm thời điểm cập nhật và hạn khóa tạm do đăng nhập sai — vẫn không bao
 * giờ gồm `passwordHash`.
 */
const DETAIL_FIELDS = {
  ...PUBLIC_FIELDS,
  updatedAt: true,
  lockedUntil: true,
} as const;

/** Mã lỗi Prisma khi vi phạm ràng buộc duy nhất (ở đây là `email`). */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === PRISMA_UNIQUE_VIOLATION;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  findAll() {
    return this.prisma.user.findMany({
      select: PUBLIC_FIELDS,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: DETAIL_FIELDS,
    });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    return user;
  }

  async create(dto: CreateUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    try {
      return await this.prisma.user.create({
        data: {
          email: dto.email,
          name: dto.name,
          role: dto.role,
          passwordHash,
        },
        select: PUBLIC_FIELDS,
      });
    } catch (error) {
      // Email trùng: trả 409 thay vì để lỗi Prisma nổi lên thành 500.
      if (isUniqueViolation(error)) {
        throw new ConflictException('Email này đã được sử dụng');
      }
      throw error;
    }
  }

  /**
   * Cập nhật tài khoản. `actorId` là người đang thao tác — dùng để chặn tự hạ
   * quyền / tự khóa chính mình, tránh tự nhốt mình ra khỏi hệ thống.
   */
  async update(id: string, dto: UpdateUserDto, actorId: string) {
    const target = await this.findOne(id);
    const isSelf = id === actorId;

    if (isSelf && dto.role !== undefined && dto.role !== target.role) {
      throw new BadRequestException('Không thể tự đổi vai trò của chính mình');
    }
    if (isSelf && dto.isActive === false) {
      throw new BadRequestException(
        'Không thể tự khóa tài khoản của chính mình',
      );
    }

    // Hạ quyền hoặc khóa Super Admin cuối cùng sẽ làm mất lối vào hệ thống.
    const losesSuperAdmin =
      target.role === Role.SUPER_ADMIN &&
      ((dto.role !== undefined && dto.role !== Role.SUPER_ADMIN) ||
        dto.isActive === false);
    if (losesSuperAdmin) {
      await this.assertNotLastSuperAdmin(id);
    }

    const { password, ...rest } = dto;
    const data = password
      ? { ...rest, passwordHash: await bcrypt.hash(password, SALT_ROUNDS) }
      : rest;

    let updated: Awaited<ReturnType<UsersService['findOne']>>;
    try {
      updated = await this.prisma.user.update({
        where: { id },
        data,
        select: DETAIL_FIELDS,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Email này đã được sử dụng');
      }
      throw error;
    }

    // Đổi vai trò, đổi mật khẩu hoặc khóa tài khoản đều phải kết thúc phiên cũ:
    // access token cũ vẫn mang `role` cũ cho tới khi hết hạn.
    const roleChanged = dto.role !== undefined && dto.role !== target.role;
    if (roleChanged || password || dto.isActive === false) {
      await this.authService.revokeAllTokens(id);
    }
    return updated;
  }

  /** Vô hiệu hóa tài khoản (soft delete) và thu hồi mọi phiên đang mở. */
  async remove(id: string, actorId: string) {
    const target = await this.findOne(id);

    if (id === actorId) {
      throw new BadRequestException(
        'Không thể tự xóa tài khoản của chính mình',
      );
    }
    if (target.role === Role.SUPER_ADMIN) {
      await this.assertNotLastSuperAdmin(id);
    }

    await this.prisma.user.update({ where: { id }, data: { isActive: false } });
    await this.authService.revokeAllTokens(id);
    return { deactivated: true };
  }

  /** Ném lỗi nếu `id` là Super Admin đang hoạt động duy nhất còn lại. */
  private async assertNotLastSuperAdmin(id: string) {
    const remaining = await this.prisma.user.count({
      where: { role: Role.SUPER_ADMIN, isActive: true, id: { not: id } },
    });
    if (remaining === 0) {
      throw new BadRequestException(
        'Phải còn ít nhất một Super Admin đang hoạt động',
      );
    }
  }
}
