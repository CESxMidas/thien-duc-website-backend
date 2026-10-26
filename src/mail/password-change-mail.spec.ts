import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { MailOutboxService } from './mail-outbox.service';

const mockSend = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: (...args: unknown[]): unknown => mockSend(...args) },
  })),
}));

describe('Email mã đổi mật khẩu', () => {
  const email = {
    to: 'member@thienduc.vn',
    code: '123456',
    expiresAt: new Date('2026-10-27T03:00:00Z'),
  };
  beforeEach(() => jest.clearAllMocks());
  it('thiếu cấu hình phải báo thất bại thay vì giả vờ đã gửi', async () => {
    const service = new MailService(new ConfigService({}));
    service.onModuleInit();
    expect(await service.sendPasswordChangeCode(email)).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });
  it('provider báo lỗi hoặc ném lỗi đều trả false', async () => {
    const service = new MailService(
      new ConfigService({
        RESEND_API_KEY: 'test-only',
        MAIL_FROM: 'CMS <cms@thienduc.vn>',
      }),
    );
    service.onModuleInit();
    mockSend.mockResolvedValueOnce({
      error: { message: 'failed' },
      data: null,
    });
    expect(await service.sendPasswordChangeCode(email)).toBe(false);
    mockSend.mockRejectedValueOnce(new Error('network'));
    expect(await service.sendPasswordChangeCode(email)).toBe(false);
  });
  it('gửi mã và giờ VN trong email, không cần URL đặt lại mật khẩu', async () => {
    const service = new MailService(
      new ConfigService({
        RESEND_API_KEY: 'test-only',
        MAIL_FROM: 'CMS <cms@thienduc.vn>',
      }),
    );
    service.onModuleInit();
    mockSend.mockResolvedValueOnce({ error: null, data: { id: 'sent' } });
    expect(await service.sendPasswordChangeCode(email)).toBe(true);
    const [sent] = mockSend.mock.calls[0] as [{ to: string; text: string }];
    expect(sent.to).toBe(email.to);
    expect(sent.text).toContain(email.code);
    expect(sent.text).toContain('10:00:00');
  });
  it('transport giả chỉ ghi hộp thư kiểm thử và phản ánh lỗi gửi', async () => {
    const outbox = new MailOutboxService();
    const service = new MailService(
      new ConfigService({ MAIL_FAKE_TRANSPORT: '1' }),
      outbox,
    );
    service.onModuleInit();
    expect(await service.sendPasswordChangeCode(email)).toBe(true);
    expect(outbox.list()[0]).toMatchObject({
      type: 'password-change',
      to: email.to,
    });
    outbox.setFailMode(true);
    expect(await service.sendPasswordChangeCode(email)).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
