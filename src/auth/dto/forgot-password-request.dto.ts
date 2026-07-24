import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

/**
 * Yêu cầu gửi email đặt lại mật khẩu. Chỉ nhận `email` — không có `userId`,
 * `role`, `isActive`… ValidationPipe toàn cục (`whitelist +
 * forbidNonWhitelisted`) reject 400 mọi field lạ. Response luôn trung tính nên
 * DTO không được là kênh dò tài khoản.
 */
export class ForgotPasswordRequestDto {
  @ApiProperty({ maxLength: 254 })
  @IsEmail()
  // 254 là độ dài tối đa hợp lệ của một địa chỉ email theo RFC 5321.
  @MaxLength(254)
  email!: string;
}
