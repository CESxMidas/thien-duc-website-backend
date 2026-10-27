import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';
import { JobApplicationsController } from './job-applications.controller';
import { JobApplicationsService } from './job-applications.service';

@Module({
  imports: [MailModule],
  controllers: [ContactController, JobApplicationsController],
  providers: [ContactService, JobApplicationsService],
  exports: [ContactService],
})
export class ContactModule {}
