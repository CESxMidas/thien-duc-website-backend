import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ProfileChangeStatus, Role } from '../../generated/prisma/client';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ReviewProfileRequestDto } from './dto/review-profile-request.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
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

/** Field hồ sơ cá nhân trả cho `/users/me` và trang duyệt. */
const PROFILE_FIELDS = {
  id: true,
  email: true,
  name: true,
  role: true,
  phone: true,
  avatarUrl: true,
  position: true,
  department: true,
  bio: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Các field hồ sơ nhân viên được phép tự cập nhật (khớp UpdateProfileDto). */
const EDITABLE_PROFILE_KEYS = [
  'name',
  'phone',
  'avatarUrl',
  'position',
  'department',
  'bio',
] as const;

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

  /* -----------------------------------------------------------------------
     Hồ sơ cá nhân + luồng duyệt cập nhật
     ----------------------------------------------------------------------- */

  /** Hồ sơ của người đang đăng nhập, kèm yêu cầu cập nhật đang chờ (nếu có). */
  async getMyProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PROFILE_FIELDS,
    });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    const pendingRequest = await this.prisma.profileChangeRequest.findFirst({
      where: { userId, status: ProfileChangeStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });

    return { ...user, pendingRequest };
  }

  /**
   * Nhân viên gửi cập nhật hồ sơ. Chỉ giữ field thực sự thay đổi so với hiện tại.
   * - ADMIN/SUPER_ADMIN: áp thẳng vào hồ sơ (tự duyệt, vẫn lưu vết đã duyệt).
   * - EDITOR: tạo/ghi đè một yêu cầu PENDING (mỗi người tối đa một yêu cầu chờ).
   */
  async submitProfileChange(userId: string, dto: UpdateProfileDto, role: Role) {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PROFILE_FIELDS,
    });
    if (!current) throw new NotFoundException('Không tìm thấy người dùng');

    // Lọc field có gửi và khác giá trị hiện tại — tránh yêu cầu rỗng vô nghĩa.
    const payload: Record<string, string> = {};
    for (const key of EDITABLE_PROFILE_KEYS) {
      const value = dto[key];
      if (value === undefined) continue;
      const trimmed = value.trim();
      if (trimmed !== (current[key] ?? '')) payload[key] = trimmed;
    }

    if (Object.keys(payload).length === 0) {
      throw new BadRequestException('Không có thay đổi nào để cập nhật');
    }
    if (payload.name !== undefined && payload.name === '') {
      throw new BadRequestException('Tên hiển thị không được để trống');
    }

    const isPrivileged = role === Role.ADMIN || role === Role.SUPER_ADMIN;

    if (isPrivileged) {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: payload,
        select: PROFILE_FIELDS,
      });
      await this.prisma.profileChangeRequest.create({
        data: {
          userId,
          payload: payload,
          status: ProfileChangeStatus.APPROVED,
          reviewedById: userId,
          reviewedAt: new Date(),
          reviewNote: 'Tự cập nhật (quyền quản trị)',
        },
      });
      return { ...updated, pendingRequest: null, applied: true };
    }

    // EDITOR: mỗi người chỉ giữ một yêu cầu PENDING — có sẵn thì ghi đè.
    const existing = await this.prisma.profileChangeRequest.findFirst({
      where: { userId, status: ProfileChangeStatus.PENDING },
    });
    const pendingRequest = existing
      ? await this.prisma.profileChangeRequest.update({
          where: { id: existing.id },
          data: { payload: payload },
        })
      : await this.prisma.profileChangeRequest.create({
          data: { userId, payload: payload },
        });

    return { ...current, pendingRequest, applied: false };
  }

  /** Danh sách yêu cầu cập nhật hồ sơ cho ADMIN/SUPER_ADMIN duyệt. */
  listProfileRequests(status?: ProfileChangeStatus) {
    return this.prisma.profileChangeRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatarUrl: true,
          },
        },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
  }

  /** Duyệt hoặc từ chối một yêu cầu. Duyệt → áp payload vào hồ sơ người gửi. */
  async reviewProfileRequest(
    id: string,
    dto: ReviewProfileRequestDto,
    reviewerId: string,
  ) {
    const request = await this.prisma.profileChangeRequest.findUnique({
      where: { id },
    });
    if (!request) throw new NotFoundException('Không tìm thấy yêu cầu');
    if (request.status !== ProfileChangeStatus.PENDING) {
      throw new BadRequestException('Yêu cầu này đã được xử lý');
    }

    if (dto.action === 'APPROVE') {
      const payload = request.payload as Record<string, string>;
      await this.prisma.user.update({
        where: { id: request.userId },
        data: payload,
      });
    }

    return this.prisma.profileChangeRequest.update({
      where: { id },
      data: {
        status:
          dto.action === 'APPROVE'
            ? ProfileChangeStatus.APPROVED
            : ProfileChangeStatus.REJECTED,
        reviewNote: dto.note ?? null,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
  }
}
