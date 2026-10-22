import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsNotBlank } from '../../common/validators/not-blank';

const MAX_ITEMS = 50;
const MAX_ITEM_LENGTH = 5000;

export class TranslatedTextListDto {
  @ApiProperty({
    type: [String],
    description: 'Danh sách nội dung tiếng Việt.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @IsString({ each: true })
  @IsNotBlank({ each: true })
  @MaxLength(MAX_ITEM_LENGTH, { each: true })
  vi!: string[];

  @ApiProperty({
    type: [String],
    required: false,
    description: 'Danh sách nội dung tiếng Anh, không bắt buộc.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @IsString({ each: true })
  @IsNotBlank({ each: true })
  @MaxLength(MAX_ITEM_LENGTH, { each: true })
  en?: string[];
}

export { MAX_ITEMS as MAX_RECRUITMENT_LIST_ITEMS };
