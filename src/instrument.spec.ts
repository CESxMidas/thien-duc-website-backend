import type { ErrorEvent } from '@sentry/nestjs';

/**
 * Nạp `instrument.ts` CÓ KIỂM SOÁT.
 *
 * Vì sao không `import` tĩnh: `instrument.ts` cố ý chạy side-effect ngay lúc
 * import (nó phải là import ĐẦU TIÊN của `main.ts`, trước cả Nest bootstrap).
 * Import tĩnh trong test khiến mọi lần `npm test` in
 * `Thiếu SENTRY_DSN — bỏ qua error tracking` ra stderr — một cảnh báo ĐÚNG với
 * production nhưng là NHIỄU trong test, và nhiễu quen mắt thì che mất cảnh báo
 * thật. Nạp qua đây biến nó thành thứ được KHẲNG ĐỊNH.
 *
 * Sửa hoàn toàn ở tầng test — `instrument.ts` (mã production) KHÔNG đổi một
 * dòng nào, nên hành vi cảnh báo lúc boot production vẫn nguyên vẹn.
 */
function loadInstrument(env: { SENTRY_DSN?: string }): {
  scrubSentryEvent: (event: ErrorEvent) => ErrorEvent;
  warnings: string[];
} {
  const previousDsn = process.env.SENTRY_DSN;
  if (env.SENTRY_DSN === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = env.SENTRY_DSN;

  // Thu cảnh báo vào mảng rồi TRẢ LẠI `console.warn` ngay — không để spy sống
  // qua khỏi hàm này. Bản đầu trả về spy còn hoạt động, và spy tạo ở thân
  // `describe` (lúc thu thập test) chồng lên spy của chính test → cùng một
  // cảnh báo bị đếm hai lần. Trả dữ liệu thay vì trả spy thì không thể chồng.
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };

  jest.resetModules();
  try {
    // `jest.requireActual` (không phải `require` trần): jest chạy CommonJS nên
    // `await import()` động sẽ cần cờ `--experimental-vm-modules`.
    const loaded =
      jest.requireActual<typeof import('./instrument')>('./instrument');
    return { scrubSentryEvent: loaded.scrubSentryEvent, warnings };
  } finally {
    console.warn = original;
    if (previousDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = previousDsn;
  }
}

describe('instrument — cảnh báo khi thiếu SENTRY_DSN', () => {
  it('thiếu DSN → cảnh báo ĐÚNG MỘT LẦN (không init, app vẫn chạy)', () => {
    const { warnings } = loadInstrument({ SENTRY_DSN: undefined });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Thiếu SENTRY_DSN');
  });
});

/**
 * CMS-ACCOUNT-INVITATION-PHASE2B / mục 8: xác nhận token lời mời (trong URL)
 * và mật khẩu (trong request body) không bao giờ tới Sentry — `beforeSend`
 * xoá nguyên `event.request`.
 */
describe('scrubSentryEvent', () => {
  const { scrubSentryEvent } = loadInstrument({ SENTRY_DSN: undefined });

  it('xoá toàn bộ event.request (URL có ?token= và body mật khẩu)', () => {
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
