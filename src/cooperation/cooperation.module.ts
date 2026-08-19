import { Module } from '@nestjs/common';
import { CooperationController } from './cooperation.controller';
import { CooperationSchedulerService } from './cooperation-scheduler.service';
import { CooperationService } from './cooperation.service';

@Module({
  controllers: [CooperationController],
  providers: [CooperationService, CooperationSchedulerService],
  exports: [CooperationService],
})
export class CooperationModule {}
