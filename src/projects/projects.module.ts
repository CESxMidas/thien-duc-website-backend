import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsSchedulerService } from './projects-scheduler.service';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsSchedulerService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
