import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateBrandingSettingsDto } from './dto/update-branding-settings.dto';
import { UpdateCompanyContactDto } from './dto/update-company-contact.dto';
import { CompanyContact, DEFAULT_COMPANY_CONTACT } from './company-contact';

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

  async getCompanyContact(): Promise<CompanyContact> {
    const setting = await this.prisma.siteSetting.findUnique({
      where: { key: 'company-contact' },
    });
    return setting
      ? (setting.value as CompanyContact)
      : structuredClone(DEFAULT_COMPANY_CONTACT);
  }

  async updateCompanyContact(
    dto: UpdateCompanyContactDto,
  ): Promise<CompanyContact> {
    const next: CompanyContact = {
      phone: dto.phone.trim(),
      email: dto.email.trim(),
      taxCode: dto.taxCode.trim(),
      address: {
        vi: dto.address.vi.trim(),
        ...(dto.address.en?.trim() ? { en: dto.address.en.trim() } : {}),
      },
    };
    await this.prisma.siteSetting.upsert({
      where: { key: 'company-contact' },
      create: { key: 'company-contact', value: next },
      update: { value: next },
    });
    return next;
  }

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
