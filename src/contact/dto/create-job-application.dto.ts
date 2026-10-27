import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateJobApplicationDto {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Matches(/\S/)
  name!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^(0|\+84)\d{9,10}$/)
  phone!: string;

  @ApiProperty()
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2000)
  cvLink?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  message?: string;

  @ApiPropertyOptional({ enum: ['vi', 'en'] })
  @IsOptional()
  @IsIn(['vi', 'en'])
  locale?: 'vi' | 'en';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;
}
