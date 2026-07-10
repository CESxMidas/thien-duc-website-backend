import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export const SEARCH_TYPES = ['all', 'projects', 'news'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;

export class SearchQueryDto {
  @ApiProperty({
    description: 'Từ khóa tìm kiếm, tối thiểu 2 ký tự.',
    example: 'Hưng Phú',
  })
  @IsString()
  @MinLength(2, { message: 'Từ khóa phải có ít nhất 2 ký tự' })
  q!: string;

  @ApiPropertyOptional({
    enum: SEARCH_TYPES,
    default: 'all',
    description: 'Giới hạn phạm vi tìm kiếm.',
  })
  @IsOptional()
  @IsIn(SEARCH_TYPES)
  type: SearchType = 'all';

  @ApiPropertyOptional({
    default: SEARCH_DEFAULT_LIMIT,
    maximum: SEARCH_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SEARCH_MAX_LIMIT)
  limit: number = SEARCH_DEFAULT_LIMIT;
}
