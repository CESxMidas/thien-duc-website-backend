import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';
import { Role } from '../../../generated/prisma/client';

/**
 * Tạo tài khoản CMS qua lời mời — KHÔNG có field mật khẩu. SUPER_ADMIN không
 * được chọn hay biết mật khẩu vĩnh viễn của người được mời; người đó tự đặt
 * mật khẩu qua email lời mời (xem AuthService.acceptInvitation). ValidationPipe
 * toàn cục dùng `whitelist + forbidNonWhitelisted` nên gửi kèm `password`
 * hoặc bất kỳ field nội bộ nào (`setupCompletedAt`, `isActive`, `passwordHash`,
 * `failedLoginAttempts`, `lockedUntil`, token...) sẽ bị 400 ngay tại đây.
 */
export class CreateAccountInvitationDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role!: Role;
}
