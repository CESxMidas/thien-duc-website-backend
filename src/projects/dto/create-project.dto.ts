import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ProjectStatus } from '../../../generated/prisma/client';
import { TranslatedTextDto } from '../../common/dto/translated-text.dto';

export class CreateProjectDto {
  @ApiProperty()
  @IsString()
  slug!: string;

  @ApiProperty({ type: TranslatedTextDto })
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  title!: TranslatedTextDto;

  @ApiProperty({ type: TranslatedTextDto })
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  summary!: TranslatedTextDto;

  @ApiProperty({ enum: ProjectStatus })
  @IsEnum(ProjectStatus)
  status!: ProjectStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  description?: Record<string, unknown>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  image?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  gallery?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  category?: string;

  // `highlights`, `quickFacts`, `gallerySections` lưu dạng **mảng** JSON (mảng
  // field song ngữ / mảng {label,value} / mảng section) — dùng `@IsArray()`,
  // không phải `@IsObject()` (class-validator loại mảng khỏi `isObject`).
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

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  mapLocation?: Record<string, unknown>;
}
