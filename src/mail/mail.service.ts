import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

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
 * Gửi email thông báo có lead mới qua **Resend HTTPS API** — nhà cung cấp duy
 * nhất. Chọn Resend vì runtime Render bị chặn cổng SMTP outbound / không tới
 * được IPv6 như Gmail SMTP.
 *
 * Theo cùng khuôn với `CloudinaryService`: nếu thiếu cấu hình
 * (`RESEND_API_KEY` / `MAIL_FROM` / `CONTACT_NOTIFY_TO`) thì **degrade thành
 * no-op** (chỉ log cảnh báo) thay vì làm sập app — lead vẫn được lưu bình
 * thường, chỉ là không có email báo.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private resend: Resend | null = null;
  private from = '';
  private notifyTo = '';

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.from = this.config.get<string>('MAIL_FROM') ?? '';
    this.notifyTo = this.config.get<string>('CONTACT_NOTIFY_TO') ?? '';

    if (!apiKey || !this.from || !this.notifyTo) {
      this.logger.warn(
        `Thiếu cấu hình Resend — email thông báo liên hệ bị bỏ qua cho tới khi cấu hình đủ (lead vẫn được lưu). apiKey=${
          apiKey ? 'set' : 'missing'
        } from=${this.from ? 'set' : 'missing'} notifyTo=${
          this.notifyTo ? 'set' : 'missing'
        }`,
      );
      return;
    }

    this.resend = new Resend(apiKey);
    // Log quan sát (KHÔNG chứa secret/PII): chỉ cờ present/missing.
    this.logger.log(
      'Email provider=resend đã cấu hình: apiKey=set from=set notifyTo=set',
    );
  }

  get isConfigured(): boolean {
    return this.resend !== null;
  }

  /**
   * Gửi email báo có lead mới qua Resend. **Không bao giờ ném lỗi ra ngoài** —
   * lead đã được lưu DB nên gửi mail chỉ là phụ; lỗi được log lại (không kèm
   * cấu hình/secret) để lượt gửi hỏng không làm hỏng luồng tạo lead.
   */
  async sendContactNotification(data: ContactNotificationData): Promise<void> {
    const ref = data.submissionId ?? 'unknown';
    if (!this.resend) {
      // Resend chưa cấu hình (đã cảnh báo lúc khởi động) — bỏ qua, lead vẫn đã lưu.
      this.logger.warn(
        `Bỏ qua gửi email thông báo liên hệ: Resend chưa cấu hình (submissionId=${ref}).`,
      );
      return;
    }
    this.logger.log(
      `Bắt đầu gửi email thông báo liên hệ qua Resend (submissionId=${ref}).`,
    );
    try {
      const { data: sent, error } = await this.resend.emails.send({
        from: this.from,
        to: this.notifyTo,
        // Trả lời thẳng cho khách nếu họ để lại email.
        replyTo: data.email || undefined,
        subject: `[Website Thiên Đức] Liên hệ mới từ ${data.name}`,
        text: this.buildText(data),
        html: this.buildHtml(data),
      });
      if (error) {
        // Resend trả lỗi trong body (không throw). Chỉ log name/message an toàn.
        this.logger.error(
          `Gửi email thông báo liên hệ qua Resend thất bại (submissionId=${ref}): ${error.name} - ${error.message}`,
        );
        return;
      }
      // `id` của Resend an toàn (không chứa secret/PII).
      this.logger.log(
        `Đã gửi email thông báo liên hệ qua Resend (submissionId=${ref}, messageId=${
          sent?.id ?? 'n/a'
        }).`,
      );
    } catch (error) {
      // Chỉ log message, tuyệt đối không log API key / payload để tránh lộ PII.
      this.logger.error(
        `Gửi email thông báo liên hệ qua Resend thất bại (submissionId=${ref}): ${
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
