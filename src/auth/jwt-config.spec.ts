import { ConfigService } from '@nestjs/config';
import {
  getJwtAccessExpiresIn,
  getJwtAccessSecret,
  getRequiredConfig,
} from './jwt-config';

function configWith(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((name: string) => values[name]),
  } as unknown as ConfigService;
}

describe('JWT config', () => {
  it('throws when a required env var is missing', () => {
    const config = configWith({});

    expect(() => getRequiredConfig(config, 'JWT_ACCESS_SECRET')).toThrow(
      'Missing required environment variable: JWT_ACCESS_SECRET',
    );
  });

  it('throws when JWT_ACCESS_SECRET is empty', () => {
    const config = configWith({ JWT_ACCESS_SECRET: '' });

    expect(() => getJwtAccessSecret(config)).toThrow(
      'Missing required environment variable: JWT_ACCESS_SECRET',
    );
  });

  it('returns JWT_ACCESS_SECRET when it is configured', () => {
    const config = configWith({ JWT_ACCESS_SECRET: 'test-secret' });

    expect(getJwtAccessSecret(config)).toBe('test-secret');
  });

  it('defaults JWT_ACCESS_EXPIRES_IN to 15m', () => {
    const config = configWith({});

    expect(getJwtAccessExpiresIn(config)).toBe('15m');
  });
});
