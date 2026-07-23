import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { ProfileChangeStatus, Role } from '../../generated/prisma/client';
import { AuthService } from '../auth/auth.service';
import { generateOpaqueToken } from '../common/utils/opaque-token.util';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountInvitationDto } from './dto/create-account-invitation.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ReviewProfileRequestDto } from './dto/review-profile-request.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SALT_ROUNDS = 12;

/** Lời mời hết hạn sau 48 giờ — đủ thời gian để người được mời kiểm tra email. */
const INVITATION_TTL_MS = 48 * 60 * 60 * 1000;

/** Chặn gửi lại lời mời liên tục cho cùng một tài khoản trong 60 giây. */
const RESEND_COOLDOWN_MS = 60 * 1000;

/** Field an toàn của một lời mời — không bao giờ gồm `tokenHash`. */
const INVITATION_SAFE_FIELDS = {
  id: true,
  createdAt: true,
  expiresAt: true,
  usedAt: true,
  revokedAt: true,
} as const;

/** Các field an toàn để trả ra ngoài — không bao giờ gồm `passwordHash`. */
const PUBLIC_FIELDS = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  // NULL = tài khoản do lời mời tạo ra, chưa tự đặt mật khẩu (Admin hiển thị
  // "Chờ thiết lập"). An toàn để lộ: chỉ là mốc thời gian trạng thái, không
  // phải token/hash/mật khẩu.
  setupCompletedAt: true,
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
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly mailService: MailService,
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

  /* -----------------------------------------------------------------------
     Lời mời thiết lập tài khoản (invitation) — Phase 2A.
     ⚠️ CHƯA có cổng chặn đăng nhập dựa trên `setupCompletedAt` (Phase 2B mới
     thêm). Vì vậy giai đoạn này CHỈ là điểm kiểm tra triển khai (checkpoint),
     KHÔNG được coi là tính năng lời mời hoàn chỉnh, sẵn sàng lên production
     một mình — một tài khoản "pending" vẫn không có gì chủ động ngăn nó
     đăng nhập ngoài việc không ai biết mật khẩu giữ chỗ của nó.
     ----------------------------------------------------------------------- */

  /**
   * SUPER_ADMIN tạo tài khoản qua lời mời — không có, không thấy, không chọn
   * mật khẩu vĩnh viễn của người được mời. `passwordHash` được ghi bằng hash
   * của một chuỗi ngẫu nhiên giữ chỗ, không ai biết, không lưu ở đâu khác;
   * `setupCompletedAt` là nguồn xác thực duy nhất cho việc tài khoản đã
   * thiết lập xong hay chưa (không suy luận từ `passwordHash`).
   */
  async createInvitation(dto: CreateAccountInvitationDto, actorId: string) {
    // Giữ chỗ — không bao giờ trả ra ngoài hàm này, không log, không tái sử dụng.
    const placeholder = crypto.randomBytes(32).toString('base64url');
    const passwordHash = await bcrypt.hash(placeholder, SALT_ROUNDS);
    // `token` bản rõ chỉ sống trong bộ nhớ của hàm này đủ lâu để gửi email sau
    // khi transaction commit; DB chỉ lưu `tokenHash`. Không log, không trả HTTP.
    const { token, tokenHash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    let created: {
      user: {
        id: string;
        email: string;
        name: string;
        role: Role;
        isActive: boolean;
        createdAt: Date;
      };
      invitation: {
        id: string;
        createdAt: Date;
        expiresAt: Date;
        usedAt: Date | null;
        revokedAt: Date | null;
      };
    };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: dto.email,
            name: dto.name,
            role: dto.role,
            passwordHash,
            isActive: true,
            setupCompletedAt: null,
          },
          select: PUBLIC_FIELDS,
        });
        const invitation = await tx.accountInvitation.create({
          data: { userId: user.id, tokenHash, expiresAt, invitedById: actorId },
          select: INVITATION_SAFE_FIELDS,
        });
        return { user, invitation };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Email này đã được sử dụng');
      }
      throw error;
    }

    // Log an toàn (không token/hash/mật khẩu) — ghi TRƯỚC khi gửi mail để có
    // dấu vết kể cả khi mail lỗi.
    this.logger.log(
      `account_invitation_created invitedBy=${actorId} userId=${created.user.id} invitationId=${created.invitation.id}`,
    );

    // Gửi email SAU commit: MailService không bao giờ ném lỗi (degrade an
    // toàn), nên mail hỏng không làm rollback tài khoản/lời mời — SUPER_ADMIN
    // có thể gửi lại. Token bản rõ chỉ đi vào đúng lời gọi này rồi ra khỏi scope.
    await this.mailService.sendAccountInvitation({
      to: created.user.email,
      name: created.user.name,
      role: created.user.role,
      token,
      expiresAt: created.invitation.expiresAt,
    });

    return created;
  }

  /** Gửi lại lời mời — thu hồi lời mời cũ còn hiệu lực và tạo lời mời mới. */
  async resendInvitation(id: string, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    if (user.setupCompletedAt !== null) {
      throw new BadRequestException('Tài khoản đã hoàn tất thiết lập');
    }
    if (!user.isActive) {
      throw new BadRequestException('Tài khoản đã bị vô hiệu hóa');
    }

    const lastInvitation = await this.prisma.accountInvitation.findFirst({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
    });
    if (
      lastInvitation &&
      Date.now() - lastInvitation.createdAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      throw new HttpException(
        'Vui lòng đợi ít phút trước khi gửi lại lời mời',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Token bản rõ mới, khác hoàn toàn token của lời mời cũ (đã bị thu hồi).
    const { token, tokenHash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    const invitation = await this.prisma.$transaction(async (tx) => {
      // Lời mời cũ còn hiệu lực (nếu có) không còn dùng được nữa.
      await tx.accountInvitation.updateMany({
        where: { userId: id, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return tx.accountInvitation.create({
        data: { userId: id, tokenHash, expiresAt, invitedById: actorId },
        select: INVITATION_SAFE_FIELDS,
      });
    });

    this.logger.log(
      `account_invitation_resent invitedBy=${actorId} userId=${id} invitationId=${invitation.id}`,
    );

    // Gửi sau commit; lời mời cũ vẫn bị thu hồi kể cả khi mail lỗi.
    await this.mailService.sendAccountInvitation({
      to: user.email,
      name: user.name,
      role: user.role,
      token,
      expiresAt: invitation.expiresAt,
    });

    return invitation;
  }

  /**
   * Thu hồi lời mời đang hiệu lực của một tài khoản. Không đụng tới
   * `isActive`, `role`, `passwordHash`, `setupCompletedAt`.
   */
  async revokeInvitation(id: string, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    if (user.setupCompletedAt !== null) {
      throw new BadRequestException(
        'Tài khoản đã hoàn tất thiết lập, không còn lời mời để thu hồi',
      );
    }

    // Idempotent: gọi lần hai khi không còn lời mời nào đang hiệu lực chỉ
    // đơn giản không thu hồi gì thêm — không phải lỗi.
    const revoked = await this.prisma.accountInvitation.updateMany({
      where: { userId: id, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    this.logger.log(
      `account_invitation_revoked actorId=${actorId} userId=${id} count=${revoked.count}`,
    );

    return { revoked: revoked.count > 0 };
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
