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
  @ApiProperty({
    maxLength: 160,
    description:
      'Slug dự án dùng trên URL công khai, ví dụ khu-do-thi-hung-phu.',
    example: 'khu-do-thi-hung-phu',
  })
  @IsString()
  @MaxLength(160)
  @IsNotBlank()
  slug!: string;

  @ApiProperty({
    type: TranslatedTextDto,
    description: 'Tên dự án hiển thị ở danh sách và trang chi tiết.',
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  title!: TranslatedTextDto;

  @ApiProperty({
    type: TranslatedTextDto,
    description: 'Mô tả ngắn cho thẻ dự án, hero và SEO.',
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  summary!: TranslatedTextDto;

  @ApiProperty({
    enum: ProjectStatus,
    description:
      'Tình trạng thi công/triển khai của dự án, không phải trạng thái xuất bản.',
  })
  @IsEnum(ProjectStatus)
  status!: ProjectStatus;

  @ApiProperty({
    required: false,
    description: 'Nội dung tổng quan dự án hiển thị trong trang chi tiết.',
  })
  @IsOptional()
  @IsObject()
  description?: Record<string, unknown>;

  @ApiProperty({
    required: false,
    type: TranslatedTextDto,
    description: 'Vị trí dự án hiển thị trên thẻ và trang chi tiết.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  location?: TranslatedTextDto;

  @ApiProperty({
    required: false,
    maxLength: 500,
    description:
      'Ảnh chính của dự án, dùng làm cover trong danh sách và trang chi tiết.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsSafeImageRef()
  image?: string;

  // Mảng URL ảnh — trần theo từng phần tử, cùng mức 500 với các field URL khác.
  @ApiProperty({
    required: false,
    type: [String],
    description: 'Danh sách URL ảnh thư viện chung của dự án.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  @IsSafeImageRef({ each: true })
  gallery?: string[];

  @ApiProperty({
    required: false,
    type: TranslatedTextDto,
    description: 'Loại hình dự án, ví dụ Khu đô thị hoặc Chung cư.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  category?: TranslatedTextDto;

  // `highlights`, `quickFacts`, `gallerySections` lưu dạng **mảng** JSON (mảng
  // field song ngữ / mảng {label,value} / mảng section) — dùng `@IsArray()`,
  // không phải `@IsObject()` (class-validator loại mảng khỏi `isObject`).
  @ApiProperty({
    required: false,
    type: [Object],
    description: 'Các điểm nổi bật của dự án, mỗi dòng là nội dung song ngữ.',
  })
  @IsOptional()
  @IsArray()
  highlights?: unknown[];

  @ApiProperty({
    required: false,
    type: [Object],
    description: 'Thông số nhanh của dự án, dạng { label, value } song ngữ.',
  })
  @IsOptional()
  @IsArray()
  quickFacts?: unknown[];

  @ApiProperty({
    required: false,
    type: [Object],
    description:
      'Các nhóm ảnh theo section, nếu website cần chia thư viện thành nhiều nhóm.',
  })
  @IsOptional()
  @IsArray()
  gallerySections?: unknown[];

  @ApiProperty({
    required: false,
    description:
      'Khối bản đồ vị trí của dự án: ảnh nền, URL Google Maps, tiêu đề, mô tả vị trí và địa chỉ.',
  })
  @IsOptional()
  @IsObject()
  mapLocation?: Record<string, unknown>;
}
