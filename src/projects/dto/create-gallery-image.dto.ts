import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  ValidateNested,
} from 'class-validator';
import { TranslatedTextDto } from '../../common/dto/translated-text.dto';

export class CreateGalleryImageDto {
  @ApiProperty({ description: 'URL ảnh (Cloudinary hoặc đường dẫn tĩnh).' })
  @IsString()
  @IsUrl({ require_tld: false, require_protocol: false })
  url!: string;

  @ApiProperty({ required: false, type: TranslatedTextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  caption?: TranslatedTextDto;

  @ApiProperty({
    required: false,
    description:
      'Slug hạng mục nếu ảnh thuộc một hạng mục con; bỏ trống = ảnh của dự án.',
  })
  @IsOptional()
  @IsString()
  itemSlug?: string;

  @ApiProperty({
    required: false,
    description: 'Thứ tự hiển thị, nhỏ đứng trước.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
