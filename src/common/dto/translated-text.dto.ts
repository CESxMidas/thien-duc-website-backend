import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

// 5000 ký tự/field là trần chống payload khổng lồ (task →3), không phải giới
// hạn biên tập: nội dung dài (bài viết, trang) là **mảng đoạn** TranslatedTextDto
// nên mỗi đoạn ≤ 5000 không cản nội dung hợp lệ.
const MAX_TEXT_LENGTH = 5000;

export class TranslatedTextDto {
  @ApiProperty({ maxLength: MAX_TEXT_LENGTH })
  @IsString()
  @MaxLength(MAX_TEXT_LENGTH)
  vi!: string;

  @ApiProperty({ required: false, maxLength: MAX_TEXT_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT_LENGTH)
  en?: string;
}
