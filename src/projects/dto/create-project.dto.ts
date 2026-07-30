import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ProjectStatus } from '../../../generated/prisma/client';
import { TranslatedTextDto } from '../../common/dto/translated-text.dto';
import { IsSafeImageRef } from '../../common/validators/safe-url';
import { IsNotBlank } from '../../common/validators/not-blank';

export class CreateProjectDto {
  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MaxLength(160)
  @IsNotBlank()
  slug!: string;

  @ApiProperty({ type: TranslatedTextDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  title!: TranslatedTextDto;

  @ApiProperty({ type: TranslatedTextDto })
  @IsDefined()
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

  @ApiProperty({ required: false, type: TranslatedTextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  location?: TranslatedTextDto;

  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsSafeImageRef()
  image?: string;

  // Mảng URL ảnh — trần theo từng phần tử, cùng mức 500 với các field URL khác.
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  @IsSafeImageRef({ each: true })
  gallery?: string[];

  @ApiProperty({ required: false, type: TranslatedTextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  category?: TranslatedTextDto;

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
