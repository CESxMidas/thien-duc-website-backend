import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

/**
 * Sửa tài khoản: mọi field của CreateUserDto đều thành tùy chọn. `password` có
 * truyền thì đặt lại mật khẩu, bỏ qua thì giữ nguyên. `isActive` để khóa/mở lại
 * tài khoản — thiếu field này thì tài khoản bị khóa không bao giờ mở lại được.
 */
export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
