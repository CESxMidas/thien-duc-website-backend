import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { TestMailController } from './test-mail.controller';
import { TestUsersController } from './test-users.controller';
import { TestUsersService } from './test-users.service';
import { TestContactController } from './test-contact.controller';

/**
 * Module hỗ trợ E2E cục bộ — CHỈ được AppModule nạp khi NODE_ENV=test VÀ
 * MAIL_FAKE_TRANSPORT=1 (xem app.module.ts). Ở production module này không nằm
 * trong cây DI nên route /api/test/* không tồn tại. Import MailModule để dùng
 * chung MailOutboxService với MailService; PrismaService là global.
 */
@Module({
  imports: [MailModule],
  controllers: [TestMailController, TestUsersController, TestContactController],
  providers: [TestUsersService],
})
export class TestSupportModule {}
