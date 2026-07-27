import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '../../../generated/prisma/client';

/**
 * Payload tạo/ghi đè một tài khoản FIXTURE cho E2E. CHỈ dùng qua endpoint test
 * (đã chặn cứng: NODE_ENV=test + MAIL_FAKE_TRANSPORT=1 + localhost). Email bắt
 * buộc thuộc domain @e2e.test (kiểm tra ở service) để dọn dẹp không bao giờ đụng
 * tài khoản seed (@test.local) hay tài khoản thật.
 */
export class UpsertTestUserDto {
  @IsEmail()
  email!: string;

  @IsEnum(Role)
  role!: Role;

  @IsBoolean()
  isActive!: boolean;

  /** true → tài khoản đã hoàn tất thiết lập (đăng nhập được, cần password). */
  @IsBoolean()
  setupCompleted!: boolean;

  /** Bắt buộc khi setupCompleted=true; bỏ qua khi tạo tài khoản chờ thiết lập. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}
