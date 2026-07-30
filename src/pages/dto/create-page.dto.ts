import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDefined,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { LongTranslatedTextDto } from '../../common/dto/long-translated-text.dto';
import { TranslatedTextDto } from '../../common/dto/translated-text.dto';
import { IsNotBlank } from '../../common/validators/not-blank';
import { MAX_CONTENT_BLOCKS } from '../../common/dto/content-blocks';

export class CreatePageDto {
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

  /**
   * Mảng đoạn văn song ngữ, cùng quy ước với `NewsPost.content` và với
   * `StaticPage.content` mà Admin CMS đang gửi.
   *
   * Trước đây khai `@IsObject()`, nhưng class-validator **loại mảng ra khỏi
   * "object"** — nên mọi lần Admin tạo/sửa trang nội dung đều nhận `400`.
   *
   * Dùng `LongTranslatedTextDto` (trần 100_000/đoạn) chứ không phải
   * `TranslatedTextDto` (5000): đây là nội dung biên tập dài, xem lý do ở
   * `common/dto/long-translated-text.dto.ts`.
   */
  @ApiProperty({ type: [LongTranslatedTextDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => LongTranslatedTextDto)
  @ArrayMaxSize(MAX_CONTENT_BLOCKS)
  content!: LongTranslatedTextDto[];
}
