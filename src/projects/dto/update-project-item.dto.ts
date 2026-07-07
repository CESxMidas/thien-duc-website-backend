import { PartialType } from '@nestjs/swagger';
import { CreateProjectItemDto } from './create-project-item.dto';

export class UpdateProjectItemDto extends PartialType(CreateProjectItemDto) {}
