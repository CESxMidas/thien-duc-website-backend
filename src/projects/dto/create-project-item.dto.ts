import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ProjectStatus } from '../../../generated/prisma/client';
import { TranslatedTextDto } from '../../common/dto/translated-text.dto';

export class CreateProjectItemDto {
  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MaxLength(160)
  slug!: string;

  @ApiProperty({ type: TranslatedTextDto })
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  title!: TranslatedTextDto;

  @ApiProperty({ required: false, type: TranslatedTextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  summary?: TranslatedTextDto;

  @ApiProperty({ required: false, enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  image?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  description?: Record<string, unknown>;

  // Mảng JSON (xem ghi chú ở create-project.dto.ts) — dùng `@IsArray()`.
  @ApiProperty({ required: false, type: [Object] })
  @IsOptional()
  @IsArray()
  highlights?: unknown[];

  @ApiProperty({ required: false, type: [Object] })
  @IsOptional()
  @IsArray()
  quickFacts?: unknown[];

  @ApiProperty({ required: false, type: [Object] })
  @IsOptional()
  @IsArray()
  gallerySections?: unknown[];
}
