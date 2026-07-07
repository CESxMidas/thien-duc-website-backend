import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class TranslatedTextDto {
  @ApiProperty()
  @IsString()
  vi!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  en?: string;
}
