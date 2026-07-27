import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertTestUserDto } from './dto/upsert-test-user.dto';

/** Domain RIÊNG cho tài khoản fixture E2E — tách hẳn khỏi seed (@test.local). */
export const E2E_EMAIL_DOMAIN = '@e2e.test';
const SALT_ROUNDS = 12;

export interface TestUserView {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  setupCompleted: boolean;
}

/**
 * Chẩn đoán trạng thái tài khoản cho kiểm tra tính toàn vẹn (mục §9.12). KHÔNG
 * lộ `passwordHash` bản rõ — chỉ trả "vân tay" sha256 (một chiều) để so sánh
 * trước/sau một thao tác. Chỉ dùng qua endpoint test đã chặn cứng.
 */
export interface TestUserDiagnostics extends TestUserView {
  setupCompletedAt: string | null;
  failedLoginAttempts: number;
  locked: boolean;
  passwordHashFingerprint: string;
  invitationCount: number;
  activeInvitationCount: number;
  refreshTokenCount: number;
}

/**
 * Service fixture E2E — tạo/ghi đè/xoá tài khoản trong domain @e2e.test. Mọi thao
 * tác ghi đều chặn cứng theo domain để tuyệt đối không đụng tài khoản khác. KHÔNG
 * log mật khẩu/hash.
 */
@Injectable()
export class TestUsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Chặn cứng: chỉ thao tác trên email thuộc domain fixture. */
  private assertE2eDomain(email: string): void {
    if (!email.toLowerCase().endsWith(E2E_EMAIL_DOMAIN)) {
      throw new BadRequestException(
        `Email fixture phải thuộc domain ${E2E_EMAIL_DOMAIN}.`,
      );
    }
  }

  async upsert(dto: UpsertTestUserDto): Promise<TestUserView> {
    this.assertE2eDomain(dto.email);

    const setupCompletedAt = dto.setupCompleted ? new Date() : null;
    let passwordHash: string;
    if (dto.setupCompleted) {
      if (!dto.password) {
        throw new BadRequestException(
          'password bắt buộc khi setupCompleted=true.',
        );
      }
      passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    } else {
      // Tài khoản chờ thiết lập: hash một chuỗi ngẫu nhiên không ai biết
      // (không đăng nhập được), giống luồng lời mời thật.
      passwordHash = await bcrypt.hash(
        randomBytes(24).toString('hex'),
        SALT_ROUNDS,
      );
    }

    const user = await this.prisma.user.upsert({
      where: { email: dto.email },
      create: {
        email: dto.email,
        name: `E2E ${dto.role}`,
        role: dto.role,
        isActive: dto.isActive,
        setupCompletedAt,
        passwordHash,
      },
      update: {
        role: dto.role,
        isActive: dto.isActive,
        setupCompletedAt,
        passwordHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    return this.toView(user);
  }

  /** Chẩn đoán đầy đủ một tài khoản (bất kỳ email) — null nếu không có. */
  async getByEmail(email: string): Promise<TestUserDiagnostics | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return null;
    const [invitationCount, activeInvitationCount, refreshTokenCount] =
      await Promise.all([
        this.prisma.accountInvitation.count({ where: { userId: user.id } }),
        this.prisma.accountInvitation.count({
          where: { userId: user.id, usedAt: null, revokedAt: null },
        }),
        this.prisma.refreshToken.count({
          where: { userId: user.id, revokedAt: null },
        }),
      ]);
    return {
      ...this.toView(user),
      setupCompletedAt: user.setupCompletedAt
        ? user.setupCompletedAt.toISOString()
        : null,
      failedLoginAttempts: user.failedLoginAttempts,
      locked: user.lockedUntil !== null && user.lockedUntil > new Date(),
      // Vân tay một chiều của passwordHash — KHÔNG phải hash gốc, không đảo ngược.
      passwordHashFingerprint: createHash('sha256')
        .update(user.passwordHash)
        .digest('hex')
        .slice(0, 16),
      invitationCount,
      activeInvitationCount,
      refreshTokenCount,
    };
  }

  /**
   * "Làm già" mọi lời mời đang mở của một tài khoản fixture: đẩy `createdAt` lùi
   * 2 phút để vượt qua cooldown gửi-lại 60s. CHỈ chỉnh dữ liệu fixture (timestamp)
   * — KHÔNG đụng vào logic cooldown ở production. Chặn theo domain @e2e.test.
   */
  async ageInvitations(email: string): Promise<number> {
    this.assertE2eDomain(email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return 0;
    const res = await this.prisma.accountInvitation.updateMany({
      where: { userId: user.id, usedAt: null, revokedAt: null },
      data: { createdAt: new Date(Date.now() - 2 * 60 * 1000) },
    });
    return res.count;
  }

  /** Xoá MỌI tài khoản fixture (@e2e.test). Cascade dọn invitation/reset/refresh. */
  async deleteAll(): Promise<number> {
    const res = await this.prisma.user.deleteMany({
      where: { email: { endsWith: E2E_EMAIL_DOMAIN } },
    });
    return res.count;
  }

  private toView(user: {
    id: string;
    email: string;
    role: string;
    isActive: boolean;
    setupCompletedAt: Date | null;
  }): TestUserView {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      setupCompleted: user.setupCompletedAt !== null,
    };
  }
}
