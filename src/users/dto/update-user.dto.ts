import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

/**
 * Sửa tài khoản: các field của CreateUserDto thành tùy chọn, **trừ
 * `password`**. SUPER_ADMIN không được chọn / thấy / gửi mật khẩu vĩnh viễn của
 * tài khoản khác — người dùng tự đặt mật khẩu qua lời mời và tự đổi qua luồng
 * quên mật khẩu. `ValidationPipe` toàn cục bật `whitelist +
 * forbidNonWhitelisted`, nên gửi kèm `password` sẽ bị **reject 400**, không
 * phải bị bỏ qua âm thầm.
 *
 * `isActive` để khóa/mở lại tài khoản — thiếu field này thì tài khoản bị khóa
 * không bao giờ mở lại được.
 */
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password'] as const),
) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
