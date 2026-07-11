import { PartialType } from '@nestjs/swagger';
import { CreateCooperationProjectDto } from './create-cooperation-project.dto';

export class UpdateCooperationProjectDto extends PartialType(
  CreateCooperationProjectDto,
) {}
