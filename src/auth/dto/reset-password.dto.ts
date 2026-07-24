import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Đặt lại mật khẩu bằng token gửi qua email. Không có `email`, `role`, `userId`,
 * `isActive`, `setupCompletedAt`, `passwordHash` hay `tokenHash` — chính chủ chỉ
 * được đổi mật khẩu, không đụng bất kỳ thuộc tính nào khác của tài khoản.
 * ValidationPipe toàn cục (`whitelist + forbidNonWhitelisted`) reject 400 mọi
 * field lạ. Ràng buộc độ dài mật khẩu khớp luồng lời mời (min 8 / max 128).
 */
export class ResetPasswordDto {
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
