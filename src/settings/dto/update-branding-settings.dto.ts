import {
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  IsUrl,
} from 'class-validator';

export class UpdateBrandingSettingsDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== '' && value !== null)
  @IsUrl({ require_protocol: true }, { message: 'Logo phải là URL hợp lệ' })
  @MaxLength(2048)
  logoUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  logoAlt?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== '' && value !== null)
  @IsUrl({ require_protocol: true }, { message: 'Favicon phải là URL hợp lệ' })
  @MaxLength(2048)
  faviconUrl?: string | null;
}
