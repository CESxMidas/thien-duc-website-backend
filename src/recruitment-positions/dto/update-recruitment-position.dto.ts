import { PartialType } from '@nestjs/swagger';
import { CreateRecruitmentPositionDto } from './create-recruitment-position.dto';

export class UpdateRecruitmentPositionDto extends PartialType(
  CreateRecruitmentPositionDto,
) {}
