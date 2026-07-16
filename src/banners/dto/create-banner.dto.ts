import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TranslatedTextDto } from '../../common/dto/translated-text.dto';

export class CreateBannerDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  image!: string;

  @ApiProperty({ required: false, type: TranslatedTextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  eyebrow?: TranslatedTextDto;

  @ApiProperty({ type: TranslatedTextDto })
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
