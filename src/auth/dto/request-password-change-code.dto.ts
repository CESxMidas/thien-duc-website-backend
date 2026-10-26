import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class RequestPasswordChangeCodeDto {
  @ApiProperty({
    description: 'Mật khẩu hiện tại; mã chỉ gửi tới email đã đăng ký.',
  })
  @IsString()
  @MaxLength(128)
  currentPassword!: string;
}
