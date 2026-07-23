import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ValidateInvitationDto } from './dto/validate-invitation.dto';

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
}
