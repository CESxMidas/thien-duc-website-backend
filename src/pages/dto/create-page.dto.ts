import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsObject, IsString, ValidateNested } from 'class-validator';
import { TranslatedTextDto } from '../../common/dto/translated-text.dto';

export class CreatePageDto {
  @ApiProperty()
  @IsString()
  slug!: string;

  @ApiProperty({ type: TranslatedTextDto })
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  title!: TranslatedTextDto;

  @ApiProperty()
  @IsObject()
  content!: Record<string, unknown>;
}
