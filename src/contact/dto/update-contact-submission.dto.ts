import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { SubmissionStatus } from '../../../generated/prisma/client';

export class UpdateContactSubmissionDto {
  /** Optional để `PATCH` chỉ ghi chú nội bộ, không phải gửi kèm trạng thái. */
  @ApiProperty({ enum: SubmissionStatus, required: false })
  @IsOptional()
  @IsEnum(SubmissionStatus)
  status?: SubmissionStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  internalNote?: string;
}
