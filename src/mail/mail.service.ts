import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/** Dữ liệu tối thiểu để dựng email báo lead mới (lấy từ bản ghi đã lưu DB). */
export interface ContactNotificationData {
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

  onModuleInit() {
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

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 465 = TLS ngầm; 587 = STARTTLS.
      auth: { user, pass: password },
    });
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
    if (!this.transporter) return;
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: this.notifyTo,
        // Trả lời thẳng cho khách nếu họ để lại email.
        replyTo: data.email || undefined,
        subject: `[Website Thiên Đức] Liên hệ mới từ ${data.name}`,
        text: this.buildText(data),
        html: this.buildHtml(data),
      });
    } catch (error) {
      // Chỉ log message, tuyệt đối không log transporter/auth để tránh lộ SMTP.
      this.logger.error(
        `Gửi email thông báo liên hệ thất bại: ${
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
