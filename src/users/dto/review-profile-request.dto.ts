import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Quyết định của ADMIN/SUPER_ADMIN với một yêu cầu cập nhật hồ sơ. */
export class ReviewProfileRequestDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsIn(['APPROVE', 'REJECT'])
  action!: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional({
    description: 'Ghi chú kèm quyết định (nhất là khi từ chối)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
