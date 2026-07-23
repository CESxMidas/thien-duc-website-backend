import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Chỉ để UX kiểm tra trước — không phải nguồn xác thực cuối cùng.
 * `acceptInvitation` luôn tự kiểm tra lại toàn bộ điều kiện độc lập.
 */
export class ValidateInvitationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;
}
