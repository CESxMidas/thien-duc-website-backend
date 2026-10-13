import { ConfigService } from '@nestjs/config';
import type { JwtSignOptions } from '@nestjs/jwt';

export function getRequiredConfig(config: ConfigService, name: string): string {
  const value = config.get<string>(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getJwtAccessSecret(config: ConfigService): string {
  return getRequiredConfig(config, 'JWT_ACCESS_SECRET');
}

export function getJwtAccessExpiresIn(
  config: ConfigService,
): JwtSignOptions['expiresIn'] {
  return (config.get<string>('JWT_ACCESS_EXPIRES_IN') ??
    '15m') as JwtSignOptions['expiresIn'];
}
