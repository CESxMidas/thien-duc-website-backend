import { Module } from '@nestjs/common';
import { NewsController } from './news.controller';
import { NewsSchedulerService } from './news-scheduler.service';
import { NewsService } from './news.service';

@Module({
  controllers: [NewsController],
  providers: [NewsService, NewsSchedulerService],
  exports: [NewsService],
})
export class NewsModule {}
