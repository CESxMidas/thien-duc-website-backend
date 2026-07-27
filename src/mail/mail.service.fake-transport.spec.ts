import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { MailOutboxService } from './mail-outbox.service';

/**
 * Kiểm thử TRANSPORT GIẢ (E2E cục bộ): khi NODE_ENV=test + MAIL_FAKE_TRANSPORT=1,
 * MailService ghi email vào outbox thay vì gọi Resend. Đồng thời chứng minh:
 * - Khi cờ TẮT, hành vi Resend giữ nguyên (không đụng outbox).
 * - Token/URL không bao giờ bị log.
 */
const mockResendSend = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockResendSend },
  })),
}));

const RESEND_ENV = {
  RESEND_API_KEY: 're_test_key',
  MAIL_FROM: 'Thiên Đức <onboarding@resend.dev>',
  CONTACT_NOTIFY_TO: 'receiver@test.local',
  ADMIN_APP_URL: 'http://localhost:5174',
};

const RAW_INVITE_TOKEN = 'raw-invite-token-e2e-123';
const RAW_RESET_TOKEN = 'raw-reset-token-e2e-456';

function makeService(
  env: Record<string, string | undefined>,
  outbox?: MailOutboxService,
): MailService {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new MailService(config, outbox);
}

describe('MailService — transport giả (fake outbox)', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let outbox: MailOutboxService;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    outbox = new MailOutboxService();
  });

  afterEach(() => jest.restoreAllMocks());

  function allLogText(): string {
    return [logSpy, warnSpy, errorSpy]
      .flatMap((spy) => (spy.mock.calls as unknown[][]).flat())
      .filter((a): a is string => typeof a === 'string')
      .join(' | ');
  }

  function expectNoTokenLeaked(): void {
    const text = allLogText();
    expect(text).not.toContain(RAW_INVITE_TOKEN);
    expect(text).not.toContain(RAW_RESET_TOKEN);
    expect(text).not.toContain('token=');
  }

  const FAKE_ENV = { ...RESEND_ENV, MAIL_FAKE_TRANSPORT: '1' };

  it('lời mời: ghi vào outbox kèm URL có token, KHÔNG gọi Resend', async () => {
    const service = makeService(FAKE_ENV, outbox);
    service.onModuleInit();

    await service.sendAccountInvitation({
      to: 'invited@test.local',
      name: 'Người mới',
      role: 'ADMIN',
      token: RAW_INVITE_TOKEN,
      expiresAt: new Date('2026-07-30T00:00:00.000Z'),
    });

    expect(mockResendSend).not.toHaveBeenCalled();
    const entries = outbox.list('invited@test.local');
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('invitation');
    expect(entries[0].url).toContain('/thiet-lap-tai-khoan');
    expect(entries[0].url).toContain(`token=${RAW_INVITE_TOKEN}`);
    expectNoTokenLeaked();
  });

  it('đặt lại mật khẩu: ghi vào outbox kèm URL có token, KHÔNG gọi Resend', async () => {
    const service = makeService(FAKE_ENV, outbox);
    service.onModuleInit();

    await service.sendPasswordResetEmail({
      to: 'user@test.local',
      name: 'Người dùng',
      token: RAW_RESET_TOKEN,
      expiresAt: new Date('2026-07-30T00:00:00.000Z'),
    });

    expect(mockResendSend).not.toHaveBeenCalled();
    const entries = outbox.list('user@test.local');
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('password-reset');
    expect(entries[0].url).toContain('/dat-lai-mat-khau');
    expect(entries[0].url).toContain(`token=${RAW_RESET_TOKEN}`);
    expectNoTokenLeaked();
  });

  it('liên hệ: ghi vào outbox (url=null), KHÔNG gọi Resend', async () => {
    const service = makeService(FAKE_ENV, outbox);
    service.onModuleInit();

    await service.sendContactNotification({
      name: 'Khách',
      phone: '0900000000',
      message: 'Nội dung',
      createdAt: new Date(),
    });

    expect(mockResendSend).not.toHaveBeenCalled();
    const entries = outbox.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('contact');
    expect(entries[0].url).toBeNull();
  });

  it('fail-mode: email liên hệ KHÔNG ghi outbox và KHÔNG ném lỗi (lead vẫn lưu)', async () => {
    const service = makeService(FAKE_ENV, outbox);
    service.onModuleInit();
    outbox.setFailMode(true);

    await expect(
      service.sendContactNotification({
        name: 'Khách',
        phone: '0900000000',
        message: 'Nội dung',
        createdAt: new Date(),
      }),
    ).resolves.toBeUndefined();

    expect(mockResendSend).not.toHaveBeenCalled();
    expect(outbox.list().filter((e) => e.type === 'contact')).toHaveLength(0);
  });

  it('fail-mode KHÔNG ảnh hưởng email lời mời (vẫn ghi outbox)', async () => {
    const service = makeService(FAKE_ENV, outbox);
    service.onModuleInit();
    outbox.setFailMode(true);

    await service.sendAccountInvitation({
      to: 'invited@test.local',
      name: 'Người mới',
      role: 'ADMIN',
      token: RAW_INVITE_TOKEN,
      expiresAt: new Date('2026-07-30T00:00:00.000Z'),
    });
    expect(outbox.list('invited@test.local')).toHaveLength(1);
  });

  it('cờ TẮT (không có MAIL_FAKE_TRANSPORT): giữ đường Resend, KHÔNG đụng outbox', async () => {
    mockResendSend.mockResolvedValue({ data: { id: 'm1' }, error: null });
    const service = makeService(RESEND_ENV, outbox); // không có cờ
    service.onModuleInit();

    await service.sendAccountInvitation({
      to: 'invited@test.local',
      name: 'Người mới',
      role: 'ADMIN',
      token: RAW_INVITE_TOKEN,
      expiresAt: new Date('2026-07-30T00:00:00.000Z'),
    });

    expect(mockResendSend).toHaveBeenCalledTimes(1);
    expect(outbox.list()).toHaveLength(0);
  });
});
