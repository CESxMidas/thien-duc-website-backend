import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateBrandingSettingsDto } from './dto/update-branding-settings.dto';

export type BrandingSettings = {
  logoUrl: string | null;
  logoAlt: string | null;
  faviconUrl: string | null;
};

const BRANDING_KEY = 'branding';

const DEFAULT_BRANDING: BrandingSettings = {
  logoUrl: null,
  logoAlt: null,
  faviconUrl: null,
};

function cleanNullableText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function nextValue(
  dto: UpdateBrandingSettingsDto,
  key: keyof BrandingSettings,
  current: string | null,
) {
  return Object.prototype.hasOwnProperty.call(dto, key)
    ? cleanNullableText(dto[key])
    : current;
}

function parseBranding(
  value: Prisma.JsonValue | null | undefined,
): BrandingSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_BRANDING;
  }

  const record = value as Record<string, unknown>;
  return {
    logoUrl: typeof record.logoUrl === 'string' ? record.logoUrl : null,
    logoAlt: typeof record.logoAlt === 'string' ? record.logoAlt : null,
    faviconUrl:
      typeof record.faviconUrl === 'string' ? record.faviconUrl : null,
  };
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getBranding(): Promise<BrandingSettings> {
    const setting = await this.prisma.siteSetting.findUnique({
      where: { key: BRANDING_KEY },
    });

    return parseBranding(setting?.value);
  }

  async updateBranding(
    dto: UpdateBrandingSettingsDto,
  ): Promise<BrandingSettings> {
    const current = await this.getBranding();
    const next: BrandingSettings = {
      logoUrl: nextValue(dto, 'logoUrl', current.logoUrl) ?? null,
      logoAlt: nextValue(dto, 'logoAlt', current.logoAlt) ?? null,
      faviconUrl: nextValue(dto, 'faviconUrl', current.faviconUrl) ?? null,
    };

    const setting = await this.prisma.siteSetting.upsert({
      where: { key: BRANDING_KEY },
      create: { key: BRANDING_KEY, value: next },
      update: { value: next },
    });

    return parseBranding(setting.value);
  }
}
