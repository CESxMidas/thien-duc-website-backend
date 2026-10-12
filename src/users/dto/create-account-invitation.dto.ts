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
  @ApiProperty({
    description: 'Email người được mời thiết lập tài khoản CMS.',
    example: 'editor@thienduc.vn',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    description: 'Họ tên hiển thị của người dùng CMS.',
    example: 'Nguyễn Văn A',
  })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({
    enum: Role,
    description: 'Vai trò truy cập được cấp cho tài khoản CMS.',
  })
  @IsEnum(Role)
  role!: Role;
}
