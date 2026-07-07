import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ContentStatus } from '../../../generated/prisma/client';

export class UpdateContentStatusDto {
  @ApiProperty({ enum: ContentStatus })
  @IsEnum(ContentStatus)
  status!: ContentStatus;
}
