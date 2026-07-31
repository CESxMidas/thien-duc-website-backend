import type { ErrorEvent } from '@sentry/nestjs';

/**
 * CMS-ACCOUNT-INVITATION-PHASE2B / mục 8: xác nhận token lời mời (trong URL)
 * và mật khẩu (trong request body) không bao giờ tới Sentry — `beforeSend`
 * xoá nguyên `event.request`.
 *
 * `instrument.ts` chạy nhánh cảnh báo NGAY LÚC IMPORT khi thiếu `SENTRY_DSN`
 * (đúng như production khi chưa cấu hình). Import tĩnh ở đầu file vì thế in
 * `Thiếu SENTRY_DSN …` ra stderr của mọi lần chạy `npm test`. Nạp bằng
 * `loadInstrument()` thay vì import tĩnh: console được thay thế TRƯỚC khi
 * module chạy, nên cảnh báo trở thành **thứ được khẳng định** chứ không phải
 * nhiễu — và hành vi ở production không đổi một dòng nào.
 */
function loadInstrument(): {
  scrubSentryEvent: (event: ErrorEvent) => ErrorEvent;
  warn: jest.SpyInstance;
} {
  jest.resetModules();
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  delete process.env.SENTRY_DSN;
  // `require` chứ không phải `await import`: jest chạy CommonJS, `import()`
  // động cần cờ `--experimental-vm-modules` (đã đo: "A dynamic import callback
  // was invoked without --experimental-vm-modules"). Ép kiểu về đúng shape của
  // module nên không có `any` nào lọt ra ngoài hàm này.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('./instrument') as typeof import('./instrument');
  return { scrubSentryEvent: mod.scrubSentryEvent, warn };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('instrument (khởi tạo Sentry)', () => {
  it('thiếu SENTRY_DSN → chỉ cảnh báo, không init, app vẫn nạp được', () => {
    const { warn } = loadInstrument();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Thiếu SENTRY_DSN'),
    );
  });
});

describe('scrubSentryEvent', () => {
  it('xoá toàn bộ event.request (URL có ?token= và body mật khẩu)', () => {
    const { scrubSentryEvent } = loadInstrument();
    const event = {
      request: {
        url: 'https://api/auth/accept-invitation?token=raw-secret-token',
        data: {
          token: 'raw-secret-token',
          newPassword: 'MatKhauMoi123',
          confirmPassword: 'MatKhauMoi123',
        },
        headers: { authorization: 'Bearer abc' },
      },
    } as unknown as ErrorEvent;

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request).toBeUndefined();
    const serialized = JSON.stringify(scrubbed);
    expect(serialized).not.toContain('raw-secret-token');
    expect(serialized).not.toContain('MatKhauMoi123');
    expect(serialized).not.toContain('token=');
  });

  it('xoá ip_address và email khỏi event.user, giữ phần còn lại của event', () => {
    const { scrubSentryEvent } = loadInstrument();
    const event = {
      message: 'Lỗi nào đó',
      user: { id: 'u-1', ip_address: '203.0.113.9', email: 'a@b.vn' },
    } as unknown as ErrorEvent;

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.user?.ip_address).toBeUndefined();
    expect(scrubbed.user?.email).toBeUndefined();
    // Message vẫn giữ để còn truy vết được.
    expect(scrubbed.message).toBe('Lỗi nào đó');
    expect(scrubbed.user?.id).toBe('u-1');
  });
});
