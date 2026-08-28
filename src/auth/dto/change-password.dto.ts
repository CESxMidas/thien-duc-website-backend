import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Người dùng ĐANG ĐĂNG NHẬP tự đổi mật khẩu của chính mình.
 *
 * Không có `userId`, `email`, `role`, `isActive` hay bất kỳ thuộc tính tài
 * khoản nào khác: danh tính lấy từ JWT qua `@CurrentUser()`, KHÔNG bao giờ từ
 * body. `ValidationPipe` toàn cục (`whitelist + forbidNonWhitelisted`) reject
 * 400 mọi field lạ, nên client không thể lén gửi `userId` để đổi mật khẩu
 * người khác — đây là hàng rào thứ nhất, service không đọc field nào ngoài ba
 * field dưới đây là hàng rào thứ hai.
 *
 * Chính sách độ dài khớp NGUYÊN VẸN `ResetPasswordDto` và `AcceptInvitationDto`
 * (min 8 / max 128) — ba lối đặt mật khẩu phải cùng một tiêu chuẩn, nếu không
 * người dùng có thể lách qua lối yếu nhất.
 *
 * `currentPassword` cố ý KHÔNG có `@MinLength`: đây là mật khẩu ĐANG dùng, có
 * thể là mật khẩu cũ được đặt trước khi chính sách hiện tại ra đời. Ràng buộc
 * độ dài ở đây chỉ khiến người dùng hợp lệ bị chặn oan bởi lỗi validate thay vì
 * nhận đúng thông báo "Mật khẩu hiện tại không đúng."
 */
export class ChangePasswordDto {
  @ApiProperty({ description: 'Mật khẩu hiện tại, để xác minh chính chủ.' })
  @IsString()
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  confirmPassword!: string;
}
