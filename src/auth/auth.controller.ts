import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordRequestDto } from './dto/forgot-password-request.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ValidateInvitationDto } from './dto/validate-invitation.dto';
import { ValidatePasswordResetDto } from './dto/validate-password-reset.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60 * 1000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  /** Hồ sơ tài khoản đang đăng nhập — nguồn duy nhất cho tên hiển thị ở CMS. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: { id: string }) {
    return this.authService.getProfile(user.id);
  }

  @Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
  @Post('logout')
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
    return { loggedOut: true };
  }

  // Chỉ để UX kiểm tra trước — accept-invitation luôn tự xác thực lại toàn
  // bộ điều kiện độc lập, không tin vào kết quả của endpoint này.
  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  @Post('validate-invitation')
  validateInvitation(@Body() dto: ValidateInvitationDto) {
    return this.authService.validateInvitationToken(dto.token);
  }

  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  @Post('accept-invitation')
  acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.authService.acceptInvitation(dto);
  }

  // Quên mật khẩu — endpoint công khai. Response luôn trung tính (không lộ
  // email có tồn tại hay không). Throttle chặt hơn để giảm bề mặt lạm dụng.
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordRequestDto) {
    return this.authService.forgotPassword(dto.email);
  }

  // Chỉ để UX kiểm tra trước — reset-password luôn tự xác thực lại toàn bộ
  // điều kiện độc lập. Chỉ trả boolean, không kèm thông tin tài khoản.
  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  @Post('validate-password-reset')
  validatePasswordReset(@Body() dto: ValidatePasswordResetDto) {
    return this.authService.validatePasswordReset(dto.token);
  }

  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  /**
   * Người dùng ĐANG ĐĂNG NHẬP tự đổi mật khẩu của chính mình.
   *
   * Mọi vai trò (EDITOR/ADMIN/SUPER_ADMIN) đều được đổi mật khẩu CỦA CHÍNH
   * MÌNH — không có `@Roles(...)`. Danh tính lấy từ JWT qua `@CurrentUser()`,
   * KHÔNG nhận `userId` từ body/param, nên không ai đổi được mật khẩu người
   * khác qua route này (kể cả SUPER_ADMIN).
   *
   * Throttle 5 lần / 15 phút — bằng đúng `reset-password` và `forgot-password`:
   * đây cũng là một endpoint nhận mật khẩu và có nhánh so khớp bí mật, để rơi
   * về mức toàn cục (100/60s) là quá lỏng cho việc dò `currentPassword`.
   */
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  changePassword(
    @CurrentUser() user: { id: string },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.id, dto);
  }
}
