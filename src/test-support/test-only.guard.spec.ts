import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { TestOnlyGuard } from './test-only.guard';

/** Dựng ExecutionContext giả trả về request có ip cho trước. */
function ctxWithIp(ip: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
  } as unknown as ExecutionContext;
}

describe('TestOnlyGuard', () => {
  const guard = new TestOnlyGuard();
  const original = {
    NODE_ENV: process.env.NODE_ENV,
    MAIL_FAKE_TRANSPORT: process.env.MAIL_FAKE_TRANSPORT,
  };

  afterEach(() => {
    process.env.NODE_ENV = original.NODE_ENV;
    process.env.MAIL_FAKE_TRANSPORT = original.MAIL_FAKE_TRANSPORT;
  });

  it('cho qua khi test + cờ bật + localhost', () => {
    process.env.NODE_ENV = 'test';
    process.env.MAIL_FAKE_TRANSPORT = '1';
    expect(guard.canActivate(ctxWithIp('127.0.0.1'))).toBe(true);
    expect(guard.canActivate(ctxWithIp('::1'))).toBe(true);
    expect(guard.canActivate(ctxWithIp('::ffff:127.0.0.1'))).toBe(true);
  });

  it('ném 404 khi thiếu cờ MAIL_FAKE_TRANSPORT', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MAIL_FAKE_TRANSPORT;
    expect(() => guard.canActivate(ctxWithIp('127.0.0.1'))).toThrow(
      NotFoundException,
    );
  });

  it('ném 404 khi NODE_ENV không phải test (chặn production)', () => {
    process.env.NODE_ENV = 'production';
    process.env.MAIL_FAKE_TRANSPORT = '1';
    expect(() => guard.canActivate(ctxWithIp('127.0.0.1'))).toThrow(
      NotFoundException,
    );
  });

  it('ném 404 khi request không phải localhost', () => {
    process.env.NODE_ENV = 'test';
    process.env.MAIL_FAKE_TRANSPORT = '1';
    expect(() => guard.canActivate(ctxWithIp('203.0.113.9'))).toThrow(
      NotFoundException,
    );
    expect(() => guard.canActivate(ctxWithIp(undefined))).toThrow(
      NotFoundException,
    );
  });
});
