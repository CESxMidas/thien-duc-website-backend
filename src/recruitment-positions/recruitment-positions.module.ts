import { Module } from '@nestjs/common';
import { RecruitmentPositionsController } from './recruitment-positions.controller';
import { RecruitmentPositionsService } from './recruitment-positions.service';

@Module({
  controllers: [RecruitmentPositionsController],
  providers: [RecruitmentPositionsService],
  exports: [RecruitmentPositionsService],
})
export class RecruitmentPositionsModule {}
