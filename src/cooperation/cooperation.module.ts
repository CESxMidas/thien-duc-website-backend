import { Module } from '@nestjs/common';
import { CooperationController } from './cooperation.controller';
import { CooperationService } from './cooperation.service';

@Module({
  controllers: [CooperationController],
  providers: [CooperationService],
  exports: [CooperationService],
})
export class CooperationModule {}
