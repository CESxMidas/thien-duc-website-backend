import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TranslatedTextDto } from '../../common/dto/translated-text.dto';

export class CreateNewsCategoryDto {
  @ApiProperty({ example: 'tin-du-an', maxLength: 160 })
  @IsString()
  @MaxLength(160)
  slug!: string;

  @ApiProperty({ type: TranslatedTextDto })
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  name!: TranslatedTextDto;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsInt()
  order?: number;
}
