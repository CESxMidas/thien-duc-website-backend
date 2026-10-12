import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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

export class CreateProjectItemDto {
  @ApiProperty({
    maxLength: 160,
    description: 'Slug hạng mục nằm dưới slug dự án, ví dụ fancy-tower.',
    example: 'fancy-tower',
  })
  @IsString()
  @MaxLength(160)
  @IsNotBlank()
  slug!: string;

  @ApiProperty({
    type: TranslatedTextDto,
    description: 'Tên hạng mục dự án hiển thị trong tab và URL chi tiết.',
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  title!: TranslatedTextDto;

  @ApiProperty({
    required: false,
    type: TranslatedTextDto,
    description: 'Mô tả ngắn cho thẻ hạng mục.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  summary?: TranslatedTextDto;

  @ApiProperty({
    required: false,
    enum: ProjectStatus,
    description:
      'Tình trạng thi công riêng của hạng mục; bỏ trống để kế thừa dự án cha.',
  })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiProperty({
    required: false,
    maxLength: 500,
    description: 'Ảnh chính của hạng mục.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsSafeImageRef()
  image?: string;

  @ApiProperty({
    required: false,
    description: 'Nội dung chi tiết hạng mục hiển thị trên trang hạng mục.',
  })
  @IsOptional()
  @IsObject()
  description?: Record<string, unknown>;

  // Mảng JSON (xem ghi chú ở create-project.dto.ts) — dùng `@IsArray()`.
  @ApiProperty({
    required: false,
    type: [Object],
    description:
      'Các điểm nổi bật của hạng mục, mỗi dòng là nội dung song ngữ.',
  })
  @IsOptional()
  @IsArray()
  highlights?: unknown[];

  @ApiProperty({
    required: false,
    type: [Object],
    description: 'Thông số nhanh của hạng mục, dạng { label, value } song ngữ.',
  })
  @IsOptional()
  @IsArray()
  quickFacts?: unknown[];

  @ApiProperty({
    required: false,
    type: [Object],
    description: 'Các nhóm ảnh theo section của hạng mục.',
  })
  @IsOptional()
  @IsArray()
  gallerySections?: unknown[];

  @ApiProperty({
    required: false,
    default: true,
    description: 'Bật/tắt hiển thị công khai của hạng mục.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
