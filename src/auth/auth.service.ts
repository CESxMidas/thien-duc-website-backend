import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { hashOpaqueToken } from '../common/utils/opaque-token.util';
import { PrismaService } from '../prisma/prisma.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const SALT_ROUNDS = 12;

/**
 * Một thông báo lỗi duy nhất cho MỌI lý do khiến accept-invitation thất bại
 * (hết hạn, đã dùng, đã thu hồi, tài khoản vô hiệu hóa, không tồn tại, token
 * sai định dạng...) — không phân biệt công khai để không lộ thông tin tài
 * khoản/lời mời cho người cầm link.
 */
const INVITATION_GENERIC_ERROR =
  'Link thiết lập tài khoản không hợp lệ hoặc đã hết hạn.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    // 423 Locked — tách khỏi 401 để client phân biệt "sai mật khẩu" với
    // "tài khoản đang bị khóa" mà không phải dò nội dung message.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        'Tài khoản tạm khóa do đăng nhập sai quá nhiều lần',
        HttpStatus.LOCKED,
      );
    }

    // Tài khoản do lời mời tạo ra nhưng chưa tự đặt mật khẩu (setupCompletedAt
    // = null): `passwordHash` chỉ là chuỗi giữ chỗ ngẫu nhiên không ai biết.
    // Chặn TRƯỚC khi so mật khẩu để không đụng tới placeholder hash, không tăng
    // failedLoginAttempts và không khóa tài khoản vì những lần thử vô nghĩa.
    // Tài khoản có sẵn từ trước (kể cả SUPER_ADMIN hiện tại) đã được backfill
    // setupCompletedAt != null nên vẫn đăng nhập bình thường.
    if (user.setupCompletedAt === null) {
      throw new UnauthorizedException('Tài khoản chưa hoàn tất thiết lập.');
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      const failedLoginAttempts = user.failedLoginAttempts + 1;
      const shouldLock = failedLoginAttempts >= MAX_FAILED_ATTEMPTS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: shouldLock ? 0 : failedLoginAttempts,
          lockedUntil: shouldLock
            ? new Date(Date.now() + LOCK_DURATION_MS)
            : null,
        },
      });
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });

    return this.issueTokens(user.id, user.email, user.role);
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
    if (!stored) {
      throw new UnauthorizedException(
        'Refresh token không hợp lệ hoặc đã hết hạn',
      );
    }

    // Tài khoản bị vô hiệu hóa sau khi đã đăng nhập: chặn gia hạn phiên, đồng
    // thời thu hồi mọi refresh token còn sống để buộc đăng nhập lại.
    if (!stored.user.isActive) {
      await this.revokeAllTokens(stored.user.id);
      throw new UnauthorizedException('Tài khoản đã bị vô hiệu hóa');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(
      stored.user.id,
      stored.user.email,
      stored.user.role,
    );
  }

  /** Hồ sơ tài khoản đang đăng nhập. Không bao giờ trả `passwordHash`. */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true },
    });
    // Token còn hạn nhưng user đã bị xóa khỏi DB.
    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản');
    }
    return user;
  }

  async logout(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Thu hồi toàn bộ refresh token còn sống của một tài khoản — dùng khi khóa
   * tài khoản hoặc đổi vai trò, để access token cũ không sống thêm quá 15 phút
   * và phiên không thể tự gia hạn.
   */
  async revokeAllTokens(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /* -----------------------------------------------------------------------
     Lời mời thiết lập tài khoản (invitation) — Phase 2A.
     ⚠️ Chưa có cổng chặn đăng nhập dựa trên `setupCompletedAt` — `login()` ở
     trên không đọc field này. Phase 2B sẽ thêm điều kiện đó. Cho tới lúc đó,
     hai hàm dưới đây chỉ là nền tảng, KHÔNG phải một tính năng lời mời hoàn
     chỉnh sẵn sàng vận hành độc lập.
     ----------------------------------------------------------------------- */

  /**
   * Kiểm tra nhanh cho UI (chỉ để UX) — KHÔNG phải nguồn xác thực cuối cùng.
   * `acceptInvitation` luôn tự kiểm tra lại toàn bộ điều kiện một cách độc
   * lập. Không bao giờ trả email/tên/vai trò — chỉ đúng/sai.
   */
  async validateInvitationToken(token: string): Promise<{ valid: boolean }> {
    try {
      const tokenHash = hashOpaqueToken(token);
      const invitation = await this.prisma.accountInvitation.findFirst({
        where: {
          tokenHash,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: {
          user: { select: { isActive: true, setupCompletedAt: true } },
        },
      });
      const valid =
        !!invitation &&
        invitation.user.isActive &&
        invitation.user.setupCompletedAt === null;
      return { valid };
    } catch {
      // Input dị dạng hay lỗi tra cứu đều không được làm lộ 500 — coi như
      // không hợp lệ, giống mọi lý do thất bại khác của endpoint này.
      return { valid: false };
    }
  }

  /**
   * Chấp nhận lời mời + tự đặt mật khẩu đầu tiên. Toàn bộ điều kiện được
   * kiểm tra lại từ đầu trong transaction — không tin vào bất kỳ lần gọi
   * validate-invitation nào trước đó vì thời gian trôi qua giữa hai lần gọi.
   *
   * An toàn khi có nhiều request đồng thời cùng một token: bước "claim" dùng
   * `updateMany` với điều kiện `usedAt: null` làm điều kiện ghi — Postgres
   * đảm bảo chỉ đúng một transaction khớp điều kiện và thắng cuộc đua, các
   * request còn lại sẽ khớp 0 dòng và nhận lỗi chung ở trên.
   */
  async acceptInvitation(dto: AcceptInvitationDto) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('Mật khẩu xác nhận không khớp');
    }

    const tokenHash = hashOpaqueToken(dto.token);
    const now = new Date();
    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);

    const acceptedUserId = await this.prisma.$transaction(async (tx) => {
      // Claim nguyên tử: chỉ dòng còn `usedAt: null` mới khớp điều kiện ghi.
      const claim = await tx.accountInvitation.updateMany({
        where: {
          tokenHash,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (claim.count === 0) {
        throw new BadRequestException(INVITATION_GENERIC_ERROR);
      }

      const invitation = await tx.accountInvitation.findUniqueOrThrow({
        where: { tokenHash },
      });
      const user = await tx.user.findUnique({
        where: { id: invitation.userId },
      });
      if (!user || !user.isActive || user.setupCompletedAt !== null) {
        // Ném lỗi ở đây khiến toàn bộ transaction rollback — kể cả bước
        // claim phía trên — nên lời mời không bị "đốt" một cách vô ích
        // nếu tài khoản chỉ đang tạm thời không đủ điều kiện.
        throw new BadRequestException(INVITATION_GENERIC_ERROR);
      }

      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, setupCompletedAt: now },
      });

      // Các lời mời khác (nếu có) của cùng tài khoản không còn dùng được nữa.
      await tx.accountInvitation.updateMany({
        where: {
          userId: user.id,
          id: { not: invitation.id },
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });

      return user.id;
    });

    // Không tạo phiên đăng nhập ở đây — tài khoản pending không có phiên hợp
    // lệ nào để thu hồi; người dùng đăng nhập lại bình thường sau khi thiết lập.
    this.logger.log(`account_invitation_accepted userId=${acceptedUserId}`);

    return { success: true, loginRequired: true };
  }

  private async issueTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: (this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ??
        '15m') as JwtSignOptions['expiresIn'],
    });
    const refreshToken = crypto.randomBytes(48).toString('hex');
    const refreshExpiresInMs = 30 * 24 * 60 * 60 * 1000;

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshExpiresInMs),
      },
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
