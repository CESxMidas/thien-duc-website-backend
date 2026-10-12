import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsSafeImageRef } from '../../common/validators/safe-url';

export class CreateMediaAssetDto {
  @ApiProperty({
    maxLength: 500,
    description:
      'URL ảnh đã tải lên hoặc đường dẫn tĩnh được lưu trong thư viện.',
  })
  @IsString()
  @MaxLength(500)
  @IsSafeImageRef()
  url!: string;

  // public_id Cloudinary gồm thư mục + tên file — 300 là dư dả.
  @ApiProperty({
    required: false,
    maxLength: 300,
    description: 'Cloudinary public_id gồm thư mục và tên file.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  publicId?: string;

  @ApiProperty({
    required: false,
    description: 'Chiều rộng ảnh tính bằng pixel.',
  })
  @IsOptional()
  @IsInt()
  width?: number;

  @ApiProperty({
    required: false,
    description: 'Chiều cao ảnh tính bằng pixel.',
  })
  @IsOptional()
  @IsInt()
  height?: number;

  // Đuôi định dạng ảnh ("webp", "jpg"…) — 60 đã quá rộng.
  @ApiProperty({
    required: false,
    maxLength: 60,
    description: 'Định dạng ảnh, ví dụ webp, jpg hoặc png.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  format?: string;

  @ApiProperty({
    required: false,
    description: 'Dung lượng file ảnh tính bằng byte.',
  })
  @IsOptional()
  @IsInt()
  bytes?: number;

  @ApiProperty({
    required: false,
    maxLength: 200,
    description:
      'Thư mục nghiệp vụ của ảnh trong thư viện, ví dụ projects, news, banners.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  folder?: string;

  @ApiProperty({
    required: false,
    default: true,
    description: 'Bật/tắt ảnh trong thư viện media.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
