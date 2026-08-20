import { Module } from '@nestjs/common';
import { PagesController } from './pages.controller';
import { PagesSchedulerService } from './pages-scheduler.service';
import { PagesService } from './pages.service';

@Module({
  controllers: [PagesController],
  providers: [PagesService, PagesSchedulerService],
  exports: [PagesService],
})
export class PagesModule {}
