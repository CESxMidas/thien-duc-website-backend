import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  IsOptional,
  IsDefined,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { IsNotBlank } from '../../common/validators/not-blank';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

class ContactAddressDto {
  @ApiProperty({ maxLength: 500 })
  @Transform(trim)
  @IsString()
  @IsNotBlank()
  @MaxLength(500)
  vi!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  en?: string;
}

export class UpdateCompanyContactDto {
  @ApiProperty({ example: '0909 768 001', maxLength: 30 })
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  @Matches(/^\+?[\d\s().-]+$/)
  @Matches(/^(?:\D*\d){9,15}\D*$/)
  phone!: string;

  @ApiProperty({ maxLength: 254 })
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: '0309910290' })
  @Transform(trim)
  @IsString()
  @Matches(/^\d{10}(?:-?\d{3})?$/)
  taxCode!: string;

  @ApiProperty({ type: ContactAddressDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ContactAddressDto)
  address!: ContactAddressDto;
}
