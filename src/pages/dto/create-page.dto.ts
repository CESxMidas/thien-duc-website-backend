import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TranslatedTextDto } from '../../common/dto/translated-text.dto';

export class CreatePageDto {
  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MaxLength(160)
  slug!: string;

  @ApiProperty({ type: TranslatedTextDto })
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  title!: TranslatedTextDto;

  /**
   * Mảng đoạn văn song ngữ, cùng quy ước với `NewsPost.content` và với
   * `StaticPage.content` mà Admin CMS đang gửi.
   *
   * Trước đây khai `@IsObject()`, nhưng class-validator **loại mảng ra khỏi
   * "object"** — nên mọi lần Admin tạo/sửa trang nội dung đều nhận `400`.
   */
  @ApiProperty({ type: [TranslatedTextDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => TranslatedTextDto)
  content!: TranslatedTextDto[];
}
