import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailOutboxService } from './mail-outbox.service';

/** ConfigModule là global nên không cần import lại ở đây. */
@Module({
  providers: [MailService, MailOutboxService],
  exports: [MailService, MailOutboxService],
})
export class MailModule {}
