import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

/** ConfigModule là global nên không cần import lại ở đây. */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
