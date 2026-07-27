import { ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { E2eAwareThrottlerGuard } from './e2e-aware-throttler.guard';

/**
 * Guard chỉ bỏ qua rate-limit khi CẢ HAI cờ E2E cùng bật; mọi trường hợp khác
 * (đặc biệt production) phải rơi về ThrottlerGuard gốc.
 */
describe('E2eAwareThrottlerGuard', () => {
  const guard = Object.create(
    E2eAwareThrottlerGuard.prototype,
  ) as E2eAwareThrottlerGuard;
  const ctx = {} as ExecutionContext;
  const original = {
    NODE_ENV: process.env.NODE_ENV,
    MAIL_FAKE_TRANSPORT: process.env.MAIL_FAKE_TRANSPORT,
  };

  afterEach(() => {
    process.env.NODE_ENV = original.NODE_ENV;
    process.env.MAIL_FAKE_TRANSPORT = original.MAIL_FAKE_TRANSPORT;
    jest.restoreAllMocks();
  });

  it('bỏ qua rate-limit khi test + cờ E2E (không gọi super)', async () => {
    process.env.NODE_ENV = 'test';
    process.env.MAIL_FAKE_TRANSPORT = '1';
    const superSpy = jest
      .spyOn(ThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(false);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(superSpy).not.toHaveBeenCalled();
  });

  it('KHÔNG bỏ qua khi thiếu cờ MAIL_FAKE_TRANSPORT → gọi ThrottlerGuard gốc', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MAIL_FAKE_TRANSPORT;
    const superSpy = jest
      .spyOn(ThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(superSpy).toHaveBeenCalledTimes(1);
  });

  it('production (không cờ) → luôn qua ThrottlerGuard gốc', async () => {
    process.env.NODE_ENV = 'production';
    process.env.MAIL_FAKE_TRANSPORT = '1';
    const superSpy = jest
      .spyOn(ThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(true);
    await guard.canActivate(ctx);
    expect(superSpy).toHaveBeenCalledTimes(1);
  });
});
