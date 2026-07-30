import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TranslatedTextDto } from '../../common/dto/translated-text.dto';
import {
  IsSafeImageRef,
  IsSafeInternalPath,
} from '../../common/validators/safe-url';

export class CreateBannerDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  @IsSafeImageRef()
  image!: string;

  @ApiProperty({ required: false, type: TranslatedTextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  eyebrow?: TranslatedTextDto;

  @ApiProperty({ type: TranslatedTextDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  title!: TranslatedTextDto;

  @ApiProperty({ required: false, type: TranslatedTextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  subtitle?: TranslatedTextDto;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  @IsSafeInternalPath()
  href!: string;

  @ApiProperty({ required: false, type: TranslatedTextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  ctaLabel?: TranslatedTextDto;

  // Giá trị CSS object-position, vd "center 30%" — rất ngắn.
  @ApiProperty({ required: false, maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  objectPosition?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
