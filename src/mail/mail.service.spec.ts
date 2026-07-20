import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import * as nodemailer from 'nodemailer';
import { MailService, type ContactNotificationData } from './mail.service';

/**
 * Kiểm thử lựa chọn nhà cung cấp email (`MAIL_PROVIDER`) và hành vi degrade an
 * toàn. Cả Resend SDK, Nodemailer và DNS lookup đều được mock nên test KHÔNG
 * chạm mạng thật — không API key / SMTP / địa chỉ email thật nào xuất hiện.
 */
const mockResendSend = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockResendSend },
  })),
}));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn().mockResolvedValue({ address: '10.0.0.1', family: 4 }),
}));

/** Dữ liệu lead mẫu — chứa PII giả để kiểm chứng KHÔNG bị log ra. */
const data: ContactNotificationData = {
  submissionId: 'sub-1',
  name: 'Nguyễn Văn A',
  phone: '0900000000',
  email: 'khach@example.com',
  inquiryType: 'Báo giá',
  message: 'Xin báo giá dự án Hưng Phú',
  ipAddress: '203.0.113.9',
  createdAt: new Date('2026-07-16T03:00:00.000Z'),
};

/** Các chuỗi PII/secret tuyệt đối không được xuất hiện trong bất kỳ log nào. */
const FORBIDDEN_IN_LOGS = [
  'khach@example.com', // email khách
  'company@gmail.com', // CONTACT_NOTIFY_TO
  'onboarding@resend.dev', // MAIL_FROM
  're_test_key', // RESEND_API_KEY
  'Nguyễn Văn A', // tên khách
  '0900000000', // sđt
  '203.0.113.9', // IP
  'Xin báo giá dự án Hưng Phú', // nội dung
];

function makeService(env: Record<string, string | undefined>): MailService {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  return new MailService(config);
}

const RESEND_ENV = {
  MAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_test_key',
  MAIL_FROM: 'Thiên Đức <onboarding@resend.dev>',
  CONTACT_NOTIFY_TO: 'company@gmail.com',
};

const SMTP_ENV = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'smtp-user',
  SMTP_PASSWORD: 'smtp-pass',
  SMTP_FROM: 'no-reply@example.com',
  CONTACT_NOTIFY_TO: 'company@gmail.com',
};

describe('MailService — lựa chọn provider & degrade an toàn', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Chỉ lấy các đối số kiểu string đã truyền vào một logger spy. */
  function loggedStrings(spy: jest.SpyInstance): string[] {
    return (spy.mock.calls as unknown[][])
      .flat()
      .filter((arg): arg is string => typeof arg === 'string');
  }

  /** Gộp mọi đối số đã truyền vào log/warn/error để soi PII. */
  function allLogText(): string {
    return [logSpy, warnSpy, errorSpy].flatMap(loggedStrings).join(' | ');
  }

  function expectNoPiiLeaked(): void {
    const text = allLogText();
    for (const forbidden of FORBIDDEN_IN_LOGS) {
      expect(text).not.toContain(forbidden);
    }
  }

  it('mặc định dùng SMTP khi MAIL_PROVIDER không đặt', async () => {
    const service = makeService(SMTP_ENV); // không có MAIL_PROVIDER
    await service.onModuleInit();

    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
    expect(Resend).not.toHaveBeenCalled();
    expect(service.isConfigured).toBe(true);

    mockSendMail.mockResolvedValue({ messageId: 'smtp-msg-1' });
    await service.sendContactNotification(data);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockResendSend).not.toHaveBeenCalled();
    expectNoPiiLeaked();
  });

  it('chọn Resend khi MAIL_PROVIDER=resend', async () => {
    const service = makeService(RESEND_ENV);
    await service.onModuleInit();

    expect(Resend).toHaveBeenCalledTimes(1);
    expect(Resend).toHaveBeenCalledWith('re_test_key');
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(service.isConfigured).toBe(true);
  });

  it('thiếu RESEND_API_KEY → bỏ qua an toàn, không gửi, lead vẫn lưu', async () => {
    const service = makeService({ ...RESEND_ENV, RESEND_API_KEY: undefined });
    await service.onModuleInit();

    expect(Resend).not.toHaveBeenCalled();
    expect(service.isConfigured).toBe(false);
    expect(warnSpy).toHaveBeenCalled();

    await expect(
      service.sendContactNotification(data),
    ).resolves.toBeUndefined();
    expect(mockResendSend).not.toHaveBeenCalled();
    expectNoPiiLeaked();
  });

  it('thiếu CONTACT_NOTIFY_TO → bỏ qua an toàn (provider resend)', async () => {
    const service = makeService({
      ...RESEND_ENV,
      CONTACT_NOTIFY_TO: undefined,
    });
    await service.onModuleInit();

    expect(Resend).not.toHaveBeenCalled();
    expect(service.isConfigured).toBe(false);
    expect(warnSpy).toHaveBeenCalled();

    await expect(
      service.sendContactNotification(data),
    ).resolves.toBeUndefined();
    expect(mockResendSend).not.toHaveBeenCalled();
    expectNoPiiLeaked();
  });

  it('gửi Resend thành công → log messageId an toàn, không lộ PII', async () => {
    mockResendSend.mockResolvedValue({
      data: { id: 'email-abc-123' },
      error: null,
    });
    const service = makeService(RESEND_ENV);
    await service.onModuleInit();

    await service.sendContactNotification(data);

    expect(mockResendSend).toHaveBeenCalledTimes(1);
    const payload = (mockResendSend.mock.calls as unknown[][])[0][0] as {
      from: string;
      to: string;
      subject: string;
    };
    expect(payload.from).toBe(RESEND_ENV.MAIL_FROM);
    expect(payload.to).toBe(RESEND_ENV.CONTACT_NOTIFY_TO);

    const success = loggedStrings(logSpy).find((s) =>
      s.includes('messageId=email-abc-123'),
    );
    expect(success).toBeDefined();
    expect(success).toContain('submissionId=sub-1');
    expectNoPiiLeaked();
  });

  it('Resend trả error trong body → nuốt lỗi, log an toàn', async () => {
    mockResendSend.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'Domain not verified' },
    });
    const service = makeService(RESEND_ENV);
    await service.onModuleInit();

    await expect(
      service.sendContactNotification(data),
    ).resolves.toBeUndefined();

    const failure = loggedStrings(errorSpy).find((s) =>
      s.includes('validation_error'),
    );
    expect(failure).toBeDefined();
    expect(failure).toContain('submissionId=sub-1');
    expectNoPiiLeaked();
  });

  it('Resend ném exception → nuốt lỗi, không làm sập create', async () => {
    mockResendSend.mockRejectedValue(new Error('network down'));
    const service = makeService(RESEND_ENV);
    await service.onModuleInit();

    await expect(
      service.sendContactNotification(data),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    expectNoPiiLeaked();
  });
});
