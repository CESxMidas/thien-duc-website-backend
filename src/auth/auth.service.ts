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
import {
  generateOpaqueToken,
  hashOpaqueToken,
} from '../common/utils/opaque-token.util';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

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

/** Link đặt lại mật khẩu hết hạn sau 20 phút. */
const PASSWORD_RESET_TTL_MS = 20 * 60 * 1000;

/** Chặn xin link đặt lại mật khẩu liên tục cho cùng một tài khoản trong 60 giây. */
const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;

/**
 * Thông báo trung tính cho forgot-password — TRẢ VỀ GIỐNG HỆT NHAU bất kể email
 * có tồn tại hay không, tài khoản có bị khóa / chờ thiết lập / dính cooldown
 * hay không. Đây là hàng rào chống dò tài khoản (user enumeration).
 */
const FORGOT_PASSWORD_NEUTRAL_MESSAGE =
  'Nếu email tồn tại trong hệ thống, hướng dẫn đặt lại mật khẩu đã được gửi.';

/**
 * Một thông báo lỗi duy nhất cho MỌI lý do khiến reset-password thất bại (token
 * hết hạn / đã dùng / đã thu hồi / sai định dạng, tài khoản vô hiệu hóa / chờ
 * thiết lập / không tồn tại) — không phân biệt công khai để không lộ thông tin
 * tài khoản cho người cầm link.
 */
const PASSWORD_RESET_GENERIC_ERROR =
  'Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
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

  /* -----------------------------------------------------------------------
     Quên mật khẩu (forgot password) — CMS-AUTH-FORGOT-PASSWORD-PHASE1-BACKEND.
     Bảng token RIÊNG (PasswordResetToken), KHÔNG dùng chung AccountInvitation.
     ----------------------------------------------------------------------- */

  /**
   * Bắt đầu luồng quên mật khẩu. **Luôn trả về cùng một thông báo trung tính**
   * dù email có tồn tại hay không — không được để endpoint này trở thành kênh
   * dò tài khoản. Chỉ tài khoản đang hoạt động VÀ đã hoàn tất thiết lập
   * (`setupCompletedAt != null`) mới thực sự nhận email; tài khoản chờ thiết
   * lập phải đi qua luồng lời mời, không phải luồng này.
   */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Mọi điều kiện không đủ đều dẫn tới CÙNG một nhánh "không làm gì" nhưng
    // vẫn trả thông báo trung tính bên dưới — không phân biệt lý do ra ngoài.
    if (user && user.isActive && user.setupCompletedAt !== null) {
      // Cooldown: chặn spam gửi mail cho cùng tài khoản. Vẫn trả trung tính.
      const onCooldown = await this.isPasswordResetOnCooldown(user.id);
      if (!onCooldown) {
        await this.issuePasswordReset(user);
      }
    }

    return { success: true, message: FORGOT_PASSWORD_NEUTRAL_MESSAGE };
  }

  /** True nếu tài khoản vừa xin link đặt lại trong vòng cooldown (60 giây). */
  private async isPasswordResetOnCooldown(userId: string): Promise<boolean> {
    const last = await this.prisma.passwordResetToken.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return (
      !!last &&
      Date.now() - last.createdAt.getTime() < PASSWORD_RESET_COOLDOWN_MS
    );
  }

  /**
   * Tạo token đặt lại mật khẩu mới và gửi email. Thu hồi mọi token còn hiệu lực
   * trước đó của tài khoản (một link mới → link cũ vô hiệu). Token bản rõ chỉ
   * sống trong bộ nhớ đủ lâu để gửi email sau khi transaction commit; DB chỉ
   * lưu `tokenHash`. Không log, không trả HTTP token bản rõ.
   */
  private async issuePasswordReset(user: {
    id: string;
    email: string;
    name: string;
  }) {
    const { token, tokenHash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    const created = await this.prisma.$transaction(async (tx) => {
      // Token cũ còn hiệu lực (nếu có) không còn dùng được nữa.
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
        select: { id: true, expiresAt: true },
      });
    });

    // Log an toàn: chỉ id, KHÔNG token/hash/mật khẩu/email.
    this.logger.log(
      `password_reset_requested userId=${user.id} tokenId=${created.id}`,
    );

    // Gửi sau commit — MailService không bao giờ ném lỗi (degrade an toàn), nên
    // mail hỏng không rollback token và không lộ lỗi nhà cung cấp ra ngoài
    // (response vẫn trung tính). Token bản rõ chỉ đi vào đúng lời gọi này.
    await this.mailService.sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      token,
      expiresAt: created.expiresAt,
    });
  }

  /**
   * Kiểm tra nhanh cho UI (chỉ để UX) — KHÔNG phải nguồn xác thực cuối cùng.
   * `resetPassword` luôn tự kiểm tra lại toàn bộ điều kiện độc lập. Không bao
   * giờ trả email/tên/vai trò/id — chỉ đúng/sai.
   */
  async validatePasswordReset(token: string): Promise<{ valid: boolean }> {
    try {
      const tokenHash = hashOpaqueToken(token);
      const record = await this.prisma.passwordResetToken.findFirst({
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
        !!record &&
        record.user.isActive &&
        record.user.setupCompletedAt !== null;
      return { valid };
    } catch {
      // Input dị dạng hay lỗi tra cứu đều không được làm lộ 500 — coi như
      // không hợp lệ, giống mọi lý do thất bại khác của endpoint này.
      return { valid: false };
    }
  }

  /**
   * Đặt lại mật khẩu bằng token gửi qua email. Toàn bộ điều kiện được kiểm tra
   * lại từ đầu trong transaction — không tin vào lần validate trước đó.
   *
   * An toàn khi có nhiều request đồng thời cùng một token: bước "claim" dùng
   * `updateMany` với điều kiện `usedAt: null` làm điều kiện ghi — Postgres đảm
   * bảo chỉ đúng một transaction khớp và thắng cuộc đua, các request còn lại
   * khớp 0 dòng và nhận lỗi chung. Khi đặt lại thành công: đánh dấu `usedAt`,
   * cập nhật DUY NHẤT `passwordHash`, thu hồi mọi refresh token (kết thúc mọi
   * phiên) và thu hồi các token đặt lại khác — TẤT CẢ trong cùng transaction,
   * nên nếu bất kỳ bước nào lỗi thì mọi thay đổi cùng rollback.
   */
  async resetPassword(dto: ResetPasswordDto) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('Mật khẩu xác nhận không khớp');
    }

    const tokenHash = hashOpaqueToken(dto.token);
    const now = new Date();
    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);

    const resetUserId = await this.prisma.$transaction(async (tx) => {
      // Claim nguyên tử: chỉ dòng còn `usedAt: null` mới khớp điều kiện ghi.
      const claim = await tx.passwordResetToken.updateMany({
        where: {
          tokenHash,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (claim.count === 0) {
        throw new BadRequestException(PASSWORD_RESET_GENERIC_ERROR);
      }

      const record = await tx.passwordResetToken.findUniqueOrThrow({
        where: { tokenHash },
        select: { id: true, userId: true },
      });
      const user = await tx.user.findUnique({ where: { id: record.userId } });
      if (!user || !user.isActive || user.setupCompletedAt === null) {
        // Ném lỗi ở đây khiến toàn bộ transaction rollback — kể cả bước claim
        // — nên token không bị "đốt" vô ích nếu tài khoản tạm thời không đủ
        // điều kiện.
        throw new BadRequestException(PASSWORD_RESET_GENERIC_ERROR);
      }

      // Chỉ cập nhật passwordHash — KHÔNG đụng role/email/hồ sơ/setupCompletedAt.
      // Cũng KHÔNG chạm lockedUntil ở phase này (không tự mở khóa tài khoản).
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });

      // Các token đặt lại khác (nếu có) của cùng tài khoản không còn dùng được.
      await tx.passwordResetToken.updateMany({
        where: {
          userId: user.id,
          id: { not: record.id },
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });

      // Thu hồi mọi refresh token còn sống TRONG cùng transaction (không gọi
      // revokeAllTokens vì nó dùng this.prisma ngoài tx, sẽ không rollback được).
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });

      return user.id;
    });

    // Không tự đăng nhập — buộc người dùng đăng nhập lại bằng mật khẩu mới.
    this.logger.log(`password_reset_completed userId=${resetUserId}`);

    return {
      success: true,
      message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.',
    };
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
