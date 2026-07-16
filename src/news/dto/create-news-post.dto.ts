import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TranslatedTextDto } from '../../common/dto/translated-text.dto';

export class CreateNewsPostDto {
  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MaxLength(160)
  slug!: string;

  @ApiProperty({ type: TranslatedTextDto })
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  title!: TranslatedTextDto;

  @ApiProperty({ type: TranslatedTextDto })
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  summary!: TranslatedTextDto;

  /**
   * Nội dung bài viết là **mảng đoạn văn**, mỗi đoạn là một field song ngữ —
   * khớp `NewsPostDto.content: LocalizedText[]` mà frontend đang đọc.
   */
  @ApiProperty({ type: [TranslatedTextDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TranslatedTextDto)
  content?: TranslatedTextDto[];

  // UUID (36 ký tự) — 60 cho dư địa nếu đổi định dạng id.
  @ApiProperty({ required: false, maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  categoryId?: string;

  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  author?: string;

  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  image?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  eventDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
