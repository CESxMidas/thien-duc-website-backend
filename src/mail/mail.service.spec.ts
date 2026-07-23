import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { MailService, type ContactNotificationData } from './mail.service';

/**
 * Kiểm thử nhà cung cấp email duy nhất (Resend) và hành vi degrade an toàn.
 * Resend SDK được mock nên test KHÔNG chạm mạng thật — không API key / địa chỉ
 * email thật nào xuất hiện.
 */
const mockResendSend = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockResendSend },
  })),
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
  RESEND_API_KEY: 're_test_key',
  MAIL_FROM: 'Thiên Đức <onboarding@resend.dev>',
  CONTACT_NOTIFY_TO: 'company@gmail.com',
};

describe('MailService — cấu hình Resend & degrade an toàn', () => {
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

  it('cấu hình Resend khi đủ env', () => {
    const service = makeService(RESEND_ENV);
    service.onModuleInit();

    expect(Resend).toHaveBeenCalledTimes(1);
    expect(Resend).toHaveBeenCalledWith('re_test_key');
    expect(service.isConfigured).toBe(true);
  });

  it('thiếu RESEND_API_KEY → bỏ qua an toàn, không gửi, lead vẫn lưu', async () => {
    const service = makeService({ ...RESEND_ENV, RESEND_API_KEY: undefined });
    service.onModuleInit();

    expect(Resend).not.toHaveBeenCalled();
    expect(service.isConfigured).toBe(false);
    expect(warnSpy).toHaveBeenCalled();

    await expect(
      service.sendContactNotification(data),
    ).resolves.toBeUndefined();
    expect(mockResendSend).not.toHaveBeenCalled();
    expectNoPiiLeaked();
  });

  it('thiếu MAIL_FROM → bỏ qua an toàn, không gửi', async () => {
    const service = makeService({ ...RESEND_ENV, MAIL_FROM: undefined });
    service.onModuleInit();

    expect(Resend).not.toHaveBeenCalled();
    expect(service.isConfigured).toBe(false);
    expect(warnSpy).toHaveBeenCalled();

    await expect(
      service.sendContactNotification(data),
    ).resolves.toBeUndefined();
    expect(mockResendSend).not.toHaveBeenCalled();
    expectNoPiiLeaked();
  });

  it('thiếu CONTACT_NOTIFY_TO → chỉ tắt email liên hệ, client Resend vẫn dựng', async () => {
    const service = makeService({
      ...RESEND_ENV,
      CONTACT_NOTIFY_TO: undefined,
    });
    service.onModuleInit();

    // Sau khi decouple: client Resend vẫn được dựng (apiKey + from đủ) để lời
    // mời dùng được; chỉ riêng năng lực gửi email liên hệ bị tắt.
    expect(Resend).toHaveBeenCalledTimes(1);
    expect(service.isConfigured).toBe(true);
    expect(service.canSendContactNotification).toBe(false);

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
    service.onModuleInit();

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
    service.onModuleInit();

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
    service.onModuleInit();

    await expect(
      service.sendContactNotification(data),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    expectNoPiiLeaked();
  });

  // CMS-ACCOUNT-INVITATION-PHASE2B1: tách điều kiện sẵn sàng của hai loại email.
  describe('decouple năng lực gửi mail (contact vs invitation)', () => {
    const INVITE_ONLY_ENV = {
      RESEND_API_KEY: 're_test_key',
      MAIL_FROM: 'Thiên Đức <onboarding@resend.dev>',
      ADMIN_APP_URL: 'https://admin.thienduc.vn',
      // KHÔNG có CONTACT_NOTIFY_TO.
    };
    const CONTACT_ONLY_ENV = {
      ...RESEND_ENV,
      // KHÔNG có ADMIN_APP_URL.
    };
    const invite = {
      to: 'nguoimoi@thienduc.vn',
      name: 'Người mới',
      role: 'EDITOR' as const,
      token: 'raw-token-decouple',
      expiresAt: new Date('2026-07-18T03:00:00.000Z'),
    };

    it('thiếu CONTACT_NOTIFY_TO: vẫn gửi được email lời mời', async () => {
      mockResendSend.mockResolvedValue({ data: { id: 'm1' }, error: null });
      const service = makeService(INVITE_ONLY_ENV);
      service.onModuleInit();

      expect(service.isConfigured).toBe(true);
      expect(service.canSendAccountInvitation).toBe(true);
      expect(service.canSendContactNotification).toBe(false);

      await service.sendAccountInvitation(invite);
      expect(mockResendSend).toHaveBeenCalledTimes(1);
    });

    it('thiếu ADMIN_APP_URL: vẫn gửi được email thông báo liên hệ', async () => {
      mockResendSend.mockResolvedValue({ data: { id: 'm2' }, error: null });
      const service = makeService(CONTACT_ONLY_ENV);
      service.onModuleInit();

      expect(service.isConfigured).toBe(true);
      expect(service.canSendContactNotification).toBe(true);
      expect(service.canSendAccountInvitation).toBe(false);

      await service.sendContactNotification(data);
      expect(mockResendSend).toHaveBeenCalledTimes(1);
    });

    it('thiếu ADMIN_APP_URL: email lời mời no-op an toàn', async () => {
      const service = makeService(CONTACT_ONLY_ENV);
      service.onModuleInit();

      await expect(
        service.sendAccountInvitation(invite),
      ).resolves.toBeUndefined();
      expect(mockResendSend).not.toHaveBeenCalled();
    });

    it('thiếu CONTACT_NOTIFY_TO: email liên hệ no-op an toàn', async () => {
      const service = makeService(INVITE_ONLY_ENV);
      service.onModuleInit();

      await expect(
        service.sendContactNotification(data),
      ).resolves.toBeUndefined();
      expect(mockResendSend).not.toHaveBeenCalled();
    });

    it('thiếu RESEND_API_KEY: cả hai loại email đều no-op', async () => {
      const service = makeService({
        ...RESEND_ENV,
        ADMIN_APP_URL: 'https://admin.thienduc.vn',
        RESEND_API_KEY: undefined,
      });
      service.onModuleInit();

      expect(service.isConfigured).toBe(false);
      expect(service.canSendContactNotification).toBe(false);
      expect(service.canSendAccountInvitation).toBe(false);

      await service.sendContactNotification(data);
      await service.sendAccountInvitation(invite);
      expect(mockResendSend).not.toHaveBeenCalled();
    });

    it('thiếu MAIL_FROM: cả hai loại email đều no-op', async () => {
      const service = makeService({
        ...RESEND_ENV,
        ADMIN_APP_URL: 'https://admin.thienduc.vn',
        MAIL_FROM: undefined,
      });
      service.onModuleInit();

      expect(service.isConfigured).toBe(false);
      expect(service.canSendContactNotification).toBe(false);
      expect(service.canSendAccountInvitation).toBe(false);

      await service.sendContactNotification(data);
      await service.sendAccountInvitation(invite);
      expect(mockResendSend).not.toHaveBeenCalled();
    });
  });

  // CMS-ACCOUNT-INVITATION-PHASE2B: email lời mời thiết lập tài khoản.
  describe('sendAccountInvitation', () => {
    const INVITE_ENV = {
      ...RESEND_ENV,
      ADMIN_APP_URL: 'https://admin.thienduc.vn',
    };
    const RAW_TOKEN = 'raw-invitation-token-abc123';
    const invite = {
      to: 'nguoimoi@thienduc.vn',
      name: 'Nguyễn <b>Văn</b> B',
      role: 'ADMIN' as const,
      token: RAW_TOKEN,
      expiresAt: new Date('2026-07-18T03:00:00.000Z'),
    };

    /** Token/URL tuyệt đối không được rò ra bất kỳ log nào. */
    function expectNoTokenOrUrlLeaked(): void {
      const text = allLogText();
      expect(text).not.toContain(RAW_TOKEN);
      expect(text).not.toContain('token=');
      expect(text).not.toContain('/thiet-lap-tai-khoan');
    }

    it('gửi đúng người nhận, subject an toàn, có nhãn vai trò tiếng Việt', async () => {
      mockResendSend.mockResolvedValue({
        data: { id: 'invite-msg-1' },
        error: null,
      });
      const service = makeService(INVITE_ENV);
      service.onModuleInit();

      await service.sendAccountInvitation(invite);

      expect(mockResendSend).toHaveBeenCalledTimes(1);
      const payload = (mockResendSend.mock.calls as unknown[][])[0][0] as {
        from: string;
        to: string;
        subject: string;
        text: string;
        html: string;
      };
      expect(payload.to).toBe(invite.to);
      expect(payload.from).toBe(INVITE_ENV.MAIL_FROM);
      expect(payload.subject).toBe('Thiết lập tài khoản quản trị CMS');
      // Nhãn vai trò hiển thị tiếng Việt, không phải enum thô.
      expect(payload.text).toContain('Quản trị');
      expect(payload.text).not.toContain('SUPER_ADMIN');
      // Có nhắc hết hạn 48 giờ.
      expect(payload.text).toContain('48 giờ');
    });

    it('URL thiết lập chứa token đã mã hoá, nằm TRONG email (không log)', async () => {
      mockResendSend.mockResolvedValue({
        data: { id: 'invite-msg-1' },
        error: null,
      });
      const service = makeService(INVITE_ENV);
      service.onModuleInit();

      await service.sendAccountInvitation(invite);

      const payload = (mockResendSend.mock.calls as unknown[][])[0][0] as {
        text: string;
        html: string;
      };
      const expectedUrl = `https://admin.thienduc.vn/thiet-lap-tai-khoan?token=${RAW_TOKEN}`;
      expect(payload.text).toContain(expectedUrl);
      expect(payload.html).toContain(`token=${RAW_TOKEN}`);
      expectNoTokenOrUrlLeaked();
    });

    it('escape tên người dùng trong HTML (chống chèn HTML)', async () => {
      mockResendSend.mockResolvedValue({
        data: { id: 'invite-msg-1' },
        error: null,
      });
      const service = makeService(INVITE_ENV);
      service.onModuleInit();

      await service.sendAccountInvitation(invite);

      const payload = (mockResendSend.mock.calls as unknown[][])[0][0] as {
        html: string;
      };
      // Thẻ <b> trong tên phải bị escape, không nhúng thô vào HTML.
      expect(payload.html).toContain('Nguyễn &lt;b&gt;Văn&lt;/b&gt; B');
      expect(payload.html).not.toContain('Nguyễn <b>Văn</b> B');
    });

    it('thiếu ADMIN_APP_URL → bỏ qua an toàn, không gửi', async () => {
      const service = makeService({ ...RESEND_ENV, ADMIN_APP_URL: undefined });
      service.onModuleInit();

      await expect(
        service.sendAccountInvitation(invite),
      ).resolves.toBeUndefined();
      expect(mockResendSend).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      expectNoTokenOrUrlLeaked();
    });

    it('ADMIN_APP_URL http không phải localhost → bỏ qua (không hợp lệ)', async () => {
      const service = makeService({
        ...RESEND_ENV,
        ADMIN_APP_URL: 'http://admin.thienduc.vn',
      });
      service.onModuleInit();

      await expect(
        service.sendAccountInvitation(invite),
      ).resolves.toBeUndefined();
      expect(mockResendSend).not.toHaveBeenCalled();
    });

    it('chấp nhận http://localhost khi dev/test, chuẩn hoá bỏ dấu / cuối', async () => {
      mockResendSend.mockResolvedValue({
        data: { id: 'invite-msg-1' },
        error: null,
      });
      const service = makeService({
        ...RESEND_ENV,
        ADMIN_APP_URL: 'http://localhost:5173/',
      });
      service.onModuleInit();

      await service.sendAccountInvitation(invite);

      const payload = (mockResendSend.mock.calls as unknown[][])[0][0] as {
        text: string;
      };
      // Không nhân đôi dấu `/` giữa origin và path.
      expect(payload.text).toContain(
        `http://localhost:5173/thiet-lap-tai-khoan?token=${RAW_TOKEN}`,
      );
    });

    it('production: HTTPS hợp lệ được chấp nhận, HTTP bị từ chối', async () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        // HTTP ở production → từ chối.
        const httpService = makeService({
          ...RESEND_ENV,
          ADMIN_APP_URL: 'http://admin.thienduc.vn',
        });
        httpService.onModuleInit();
        await httpService.sendAccountInvitation(invite);
        expect(mockResendSend).not.toHaveBeenCalled();

        // HTTPS ở production → chấp nhận, gửi được.
        mockResendSend.mockResolvedValue({
          data: { id: 'invite-msg-1' },
          error: null,
        });
        const httpsService = makeService(INVITE_ENV);
        httpsService.onModuleInit();
        await httpsService.sendAccountInvitation(invite);
        expect(mockResendSend).toHaveBeenCalledTimes(1);
      } finally {
        process.env.NODE_ENV = original;
      }
    });

    it('ADMIN_APP_URL sai định dạng → bỏ qua an toàn', async () => {
      const service = makeService({
        ...RESEND_ENV,
        ADMIN_APP_URL: 'khong-phai-url',
      });
      service.onModuleInit();

      await expect(
        service.sendAccountInvitation(invite),
      ).resolves.toBeUndefined();
      expect(mockResendSend).not.toHaveBeenCalled();
    });

    it('thiếu Resend config → bỏ qua an toàn, không gửi', async () => {
      const service = makeService({
        ...INVITE_ENV,
        RESEND_API_KEY: undefined,
      });
      service.onModuleInit();

      await expect(
        service.sendAccountInvitation(invite),
      ).resolves.toBeUndefined();
      expect(mockResendSend).not.toHaveBeenCalled();
    });

    it('Resend trả error trong body → nuốt lỗi, không log token/URL', async () => {
      mockResendSend.mockResolvedValue({
        data: null,
        error: { name: 'validation_error', message: 'Domain not verified' },
      });
      const service = makeService(INVITE_ENV);
      service.onModuleInit();

      await expect(
        service.sendAccountInvitation(invite),
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
      expectNoTokenOrUrlLeaked();
    });

    it('Resend ném exception → nuốt lỗi, không throw, không log token/URL', async () => {
      mockResendSend.mockRejectedValue(new Error('network down'));
      const service = makeService(INVITE_ENV);
      service.onModuleInit();

      await expect(
        service.sendAccountInvitation(invite),
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
      expectNoTokenOrUrlLeaked();
    });

    it('thành công → chỉ log messageId an toàn, không token/URL', async () => {
      mockResendSend.mockResolvedValue({
        data: { id: 'invite-msg-1' },
        error: null,
      });
      const service = makeService(INVITE_ENV);
      service.onModuleInit();

      await service.sendAccountInvitation(invite);

      const success = loggedStrings(logSpy).find((s) =>
        s.includes('messageId=invite-msg-1'),
      );
      expect(success).toBeDefined();
      expectNoTokenOrUrlLeaked();
    });
  });
});
