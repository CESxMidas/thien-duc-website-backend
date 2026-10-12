import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TranslatedTextDto } from '../../common/dto/translated-text.dto';
import { IsSafeImageRef } from '../../common/validators/safe-url';

export class CreateGalleryImageDto {
  @ApiProperty({
    description: 'URL ảnh (Cloudinary hoặc đường dẫn tĩnh).',
    maxLength: 500,
  })
  @IsString()
  @IsUrl({ require_tld: false, require_protocol: false })
  @MaxLength(500)
  @IsSafeImageRef()
  url!: string;

  @ApiProperty({
    required: false,
    type: TranslatedTextDto,
    description: 'Chú thích ảnh hiển thị trong thư viện dự án.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  caption?: TranslatedTextDto;

  @ApiProperty({
    required: false,
    description:
      'Slug hạng mục nếu ảnh thuộc một hạng mục con; bỏ trống = ảnh của dự án.',
    maxLength: 160,
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  itemSlug?: string;

  @ApiProperty({
    required: false,
    description: 'Thứ tự hiển thị, nhỏ đứng trước.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @ApiProperty({
    required: false,
    default: true,
    description: 'Bật/tắt ảnh trong thư viện dự án công khai.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
