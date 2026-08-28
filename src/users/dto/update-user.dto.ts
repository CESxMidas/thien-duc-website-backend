import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { Role } from '../../../generated/prisma/client';

/**
 * Sửa tài khoản: mọi field đều tùy chọn và **không có `password`**.
 * SUPER_ADMIN không được chọn / thấy / gửi mật khẩu vĩnh viễn của tài khoản
 * khác — người dùng tự đặt mật khẩu qua lời mời, rồi tự đổi bằng
 * `POST /auth/change-password` (cần mật khẩu hiện tại, chỉ đổi được của CHÍNH
 * MÌNH) hoặc qua luồng quên mật khẩu. `ValidationPipe` toàn cục bật `whitelist + forbidNonWhitelisted`, nên
 * gửi kèm `password` sẽ bị **reject 400**, không phải bị bỏ qua âm thầm.
 *
 * `isActive` để khóa/mở lại tài khoản — thiếu field này thì tài khoản bị khóa
 * không bao giờ mở lại được.
 *
 * CMS-RETIRE-DIRECT-USER-CREATE-M1: trước đây DTO này kế thừa
 * `PartialType(OmitType(CreateUserDto, ['password']))`. `CreateUserDto` đã bị
 * gỡ cùng route tạo trực tiếp, nên các field được khai báo tường minh tại đây.
 */
export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
