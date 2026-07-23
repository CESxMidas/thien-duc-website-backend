import type { ErrorEvent } from '@sentry/nestjs';
import { scrubSentryEvent } from './instrument';

/**
 * CMS-ACCOUNT-INVITATION-PHASE2B / mục 8: xác nhận token lời mời (trong URL)
 * và mật khẩu (trong request body) không bao giờ tới Sentry — `beforeSend`
 * xoá nguyên `event.request`.
 */
describe('scrubSentryEvent', () => {
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
