import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMediaAssetDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  url!: string;

  // public_id Cloudinary gồm thư mục + tên file — 300 là dư dả.
  @ApiProperty({ required: false, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  publicId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  width?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  height?: number;

  // Đuôi định dạng ảnh ("webp", "jpg"…) — 60 đã quá rộng.
  @ApiProperty({ required: false, maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  format?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  bytes?: number;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  folder?: string;
}
