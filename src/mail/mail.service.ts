import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { lookup } from 'node:dns/promises';

/** Dữ liệu tối thiểu để dựng email báo lead mới (lấy từ bản ghi đã lưu DB). */
export interface ContactNotificationData {
  /** ID bản ghi lead — chỉ dùng để đối chiếu log, không phải PII. */
  submissionId?: string;
  name: string;
  phone: string;
  email?: string | null;
  inquiryType?: string | null;
  message: string;
  ipAddress?: string | null;
  createdAt: Date;
}

/** Hiển thị thời gian theo giờ VN (UTC+7) — dữ liệu lưu UTC trong DB. */
const VN_DATETIME = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'Asia/Ho_Chi_Minh',
});

/** Chặn HTML injection từ nội dung người dùng gửi lên khi nhúng vào email HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Gửi email qua SMTP. Theo cùng khuôn với `CloudinaryService`: nếu thiếu cấu
 * hình thì **degrade thành no-op** (chỉ log cảnh báo) thay vì làm sập app —
 * lead vẫn được lưu bình thường, chỉ là không có email báo.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private from = '';
  private notifyTo = '';

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const password = this.config.get<string>('SMTP_PASSWORD');
    const port = Number(this.config.get<string>('SMTP_PORT') ?? '587');
    this.from = this.config.get<string>('SMTP_FROM') ?? '';
    // Nơi nhận thông báo lead. Không đặt riêng thì gửi về chính địa chỉ gửi.
    this.notifyTo = this.config.get<string>('CONTACT_NOTIFY_TO') ?? this.from;

    if (!host || !user || !password || !this.from || !this.notifyTo) {
      this.logger.warn(
        'Thiếu cấu hình SMTP_* / CONTACT_NOTIFY_TO — email thông báo liên hệ bị bỏ qua cho tới khi cấu hình đủ (lead vẫn được lưu).',
      );
      return;
    }

    // Runtime này (Render) KHÔNG tới được IPv6 → smtp.gmail.com phân giải ra bản
    // ghi AAAA gây `connect ENETUNREACH …:587`. Chỉ đặt `family: 4` chưa đủ, nên
    // phân giải hostname sang IPv4 TRƯỚC rồi nối bằng chính IP đó; hostname gốc
    // vẫn được giữ cho SNI/xác thực chứng chỉ TLS.
    let ipv4Host: string;
    try {
      const resolved = await lookup(host, { family: 4 });
      ipv4Host = resolved.address;
    } catch (error) {
      // Không phân giải được IPv4 → TẮT gửi email (giữ transporter = null) thay vì
      // để app sập; lead vẫn được lưu. KHÔNG log secret/PII.
      this.logger.error(
        `Không phân giải được IPv4 cho SMTP host — tắt gửi email thông báo liên hệ (lead vẫn được lưu): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    // `@types/nodemailer` chưa khai `family`, nên khai bằng intersection
    // `& { family?: number }` để vẫn type-safe (không dùng `as any`).
    const transportOptions: SMTPTransport.Options & { family?: number } = {
      host: ipv4Host, // nối bằng IPv4 đã phân giải, tránh AAAA/IPv6.
      port,
      secure: port === 465, // 465 = TLS ngầm; 587 = STARTTLS.
      auth: { user, pass: password },
      family: 4,
      // Giữ hostname gốc cho SNI + xác thực chứng chỉ: cert cấp cho smtp.gmail.com
      // chứ không phải cho địa chỉ IP.
      tls: { servername: host },
      // Chặn treo lâu khi mạng SMTP không tới được (mặc định nodemailer rất dài:
      // connection 2 phút, socket 10 phút) — lỗi sớm và được log lại.
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    };
    this.transporter = nodemailer.createTransport(transportOptions);

    // Log quan sát (KHÔNG chứa secret/PII): host GỐC/port/secure/family/ipv4Resolved
    // + có notifyTo hay không. KHÔNG log user/from/password/địa chỉ email/IP đã phân giải.
    this.logger.log(
      `SMTP đã cấu hình: host=${host} port=${port} secure=${port === 465} family=4 ipv4Resolved=true notifyTo=${
        this.notifyTo ? 'set' : 'unset'
      }`,
    );
  }

  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  /**
   * Gửi email báo có lead mới. **Không bao giờ ném lỗi ra ngoài** — lead đã được
   * lưu DB nên gửi mail chỉ là phụ; lỗi được log lại (không kèm cấu hình/secret
   * SMTP) để lượt gửi hỏng không làm hỏng luồng tạo lead.
   */
  async sendContactNotification(data: ContactNotificationData): Promise<void> {
    const ref = data.submissionId ?? 'unknown';
    if (!this.transporter) {
      // SMTP chưa cấu hình (đã cảnh báo lúc khởi động) — bỏ qua, lead vẫn đã lưu.
      this.logger.warn(
        `Bỏ qua gửi email thông báo liên hệ: SMTP chưa cấu hình (submissionId=${ref}).`,
      );
      return;
    }
    this.logger.log(
      `Bắt đầu gửi email thông báo liên hệ (submissionId=${ref}).`,
    );
    try {
      const info = (await this.transporter.sendMail({
        from: this.from,
        to: this.notifyTo,
        // Trả lời thẳng cho khách nếu họ để lại email.
        replyTo: data.email || undefined,
        subject: `[Website Thiên Đức] Liên hệ mới từ ${data.name}`,
        text: this.buildText(data),
        html: this.buildHtml(data),
      })) as { messageId?: string };
      // `messageId` của Nodemailer an toàn (không chứa secret/PII). KHÔNG log
      // `info.accepted`/`envelope`/`response` vì có thể chứa địa chỉ người nhận.
      this.logger.log(
        `Đã gửi email thông báo liên hệ (submissionId=${ref}, messageId=${
          info.messageId ?? 'n/a'
        }).`,
      );
    } catch (error) {
      // Chỉ log message, tuyệt đối không log transporter/auth để tránh lộ SMTP.
      this.logger.error(
        `Gửi email thông báo liên hệ thất bại (submissionId=${ref}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private buildText(data: ContactNotificationData): string {
    const lines = [
      'Có một liên hệ mới được gửi từ form liên hệ trên website Thiên Đức.',
      '',
      `Họ tên: ${data.name}`,
      `Số điện thoại: ${data.phone}`,
      `Email: ${data.email || '(không cung cấp)'}`,
      `Loại yêu cầu: ${data.inquiryType || '(không có)'}`,
      `Thời gian gửi: ${VN_DATETIME.format(data.createdAt)} (giờ VN)`,
      `Địa chỉ IP: ${data.ipAddress || '(không ghi nhận)'}`,
      '',
      'Nội dung:',
      data.message,
    ];
    return lines.join('\n');
  }

  private buildHtml(data: ContactNotificationData): string {
    const row = (label: string, value: string) =>
      `<tr><td style="padding:4px 12px 4px 0;color:#59646a;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:4px 0;color:#191919">${value}</td></tr>`;

    return [
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#191919">',
      '<p>Có một liên hệ mới được gửi từ <strong>form liên hệ trên website Thiên Đức</strong>.</p>',
      '<table style="border-collapse:collapse">',
      row('Họ tên', escapeHtml(data.name)),
      row('Số điện thoại', escapeHtml(data.phone)),
      row('Email', data.email ? escapeHtml(data.email) : '(không cung cấp)'),
      row(
        'Loại yêu cầu',
        data.inquiryType ? escapeHtml(data.inquiryType) : '(không có)',
      ),
      row('Thời gian gửi', `${VN_DATETIME.format(data.createdAt)} (giờ VN)`),
      row(
        'Địa chỉ IP',
        data.ipAddress ? escapeHtml(data.ipAddress) : '(không ghi nhận)',
      ),
      '</table>',
      '<p style="margin-top:16px;color:#59646a">Nội dung:</p>',
      `<p style="white-space:pre-wrap">${escapeHtml(data.message)}</p>`,
      '</div>',
    ].join('');
  }
}
