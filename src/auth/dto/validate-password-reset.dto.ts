import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Chỉ để UX kiểm tra trước khi hiện form đặt lại mật khẩu — không phải nguồn
 * xác thực cuối cùng. `resetPassword` luôn tự kiểm tra lại toàn bộ điều kiện
 * độc lập. Chỉ nhận `token`.
 */
export class ValidatePasswordResetDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;
}
