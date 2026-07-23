import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  // AuthModule export AuthService — cần để thu hồi refresh token khi khóa tài
  // khoản / đổi vai trò / đổi mật khẩu. MailModule export MailService — gửi
  // email lời mời thiết lập tài khoản.
  imports: [AuthModule, MailModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
