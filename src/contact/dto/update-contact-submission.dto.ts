import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SubmissionStatus } from '../../../generated/prisma/client';

export class UpdateContactSubmissionDto {
  /** Optional để `PATCH` chỉ ghi chú nội bộ, không phải gửi kèm trạng thái. */
  @ApiProperty({ enum: SubmissionStatus, required: false })
  @IsOptional()
  @IsEnum(SubmissionStatus)
  status?: SubmissionStatus;

  // 1000 (gấp đôi mức note 500 của review-profile-request): ghi chú nội bộ có
  // thể cộng dồn qua nhiều lần chăm sóc một lead.
  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  internalNote?: string;
}
