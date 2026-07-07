import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { SubmissionStatus } from '../../../generated/prisma/client';

export class UpdateContactSubmissionDto {
  @ApiProperty({ enum: SubmissionStatus })
  @IsEnum(SubmissionStatus)
  status!: SubmissionStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  internalNote?: string;
}
