import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Chấp nhận lời mời + tự đặt mật khẩu đầu tiên. Không có field `email`,
 * `role`, `userId`, `isActive`, `setupCompletedAt` hay hồ sơ nào khác —
 * ValidationPipe toàn cục (`whitelist + forbidNonWhitelisted`) chặn ngay từ
 * DTO nên người được mời không thể tự đổi vai trò/email khi thiết lập.
 */
export class AcceptInvitationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  confirmPassword!: string;
}
