import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { Role } from '../../generated/prisma/client';

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

/**
 * Dữ liệu gửi email lời mời thiết lập tài khoản. `token` là token lời mời bản
 * rõ — CHỈ tồn tại ở đây để dựng link, KHÔNG bao giờ được log hay trả ra ngoài.
 */
export interface AccountInvitationData {
  to: string;
  name: string;
  role: Role;
  /** Token lời mời bản rõ — dùng dựng link, tuyệt đối không log. */
  token: string;
  expiresAt: Date;
}

/** Nhãn tiếng Việt cho vai trò — khớp nhãn hiển thị ở Admin (labels.ts). */
const ROLE_LABEL: Record<Role, string> = {
  EDITOR: 'Biên tập viên',
  ADMIN: 'Quản trị',
  SUPER_ADMIN: 'Super Admin',
};

/** Route trang tự thiết lập mật khẩu trên Admin SPA (public). */
const SETUP_PATH = '/thiet-lap-tai-khoan';

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
 * Theo cùng khuôn với `CloudinaryService`: thiếu cấu hình thì **degrade thành
 * no-op** (chỉ log cảnh báo) thay vì làm sập app.
 *
 * Điều kiện tách theo từng loại email (xem `canSend*`): client Resend cần
 * `RESEND_API_KEY` + `MAIL_FROM`; email thông báo liên hệ cần thêm
 * `CONTACT_NOTIFY_TO`; email lời mời cần thêm `ADMIN_APP_URL` hợp lệ. Thiếu
 * cấu hình riêng của một loại KHÔNG làm tắt loại kia.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private resend: Resend | null = null;
  private from = '';
  private notifyTo = '';
  /** Origin Admin SPA đã chuẩn hoá (bỏ dấu `/` cuối); '' nếu thiếu/không hợp lệ. */
  private adminAppUrl = '';

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.from = this.config.get<string>('MAIL_FROM') ?? '';
    this.notifyTo = this.config.get<string>('CONTACT_NOTIFY_TO') ?? '';
    this.adminAppUrl = this.normalizeAdminAppUrl(
      this.config.get<string>('ADMIN_APP_URL'),
    );

    // Client Resend chỉ cần `apiKey` + `from` — điều kiện CHUNG của mọi loại
    // email. Từng loại email còn có yêu cầu riêng (xem `canSend*`): thông báo
    // liên hệ cần `CONTACT_NOTIFY_TO`, lời mời cần `ADMIN_APP_URL` hợp lệ. Không
    // gộp hai yêu cầu riêng vào điều kiện dựng client, để một loại thiếu cấu
    // hình không vô tình tắt loại kia.
    if (!apiKey || !this.from) {
      this.logger.warn(
        `Thiếu cấu hình Resend cơ bản — mọi email bị bỏ qua cho tới khi cấu hình đủ. apiKey=${
          apiKey ? 'set' : 'missing'
        } from=${this.from ? 'set' : 'missing'}`,
      );
      return;
    }

    this.resend = new Resend(apiKey);
    // Log quan sát (KHÔNG chứa secret/PII/URL): chỉ cờ ready/missing từng năng lực.
    this.logger.log(
      `Email provider=resend đã cấu hình. contactNotification=${
        this.canSendContactNotification ? 'ready' : 'missing CONTACT_NOTIFY_TO'
      } accountInvitation=${
        this.canSendAccountInvitation
          ? 'ready'
          : 'missing/invalid ADMIN_APP_URL'
      }`,
    );
  }

  /** Client Resend đã dựng (apiKey + from) — điều kiện chung của mọi email. */
  get isConfigured(): boolean {
    return this.resend !== null;
  }

  /** Đủ điều kiện gửi email thông báo liên hệ: Resend + CONTACT_NOTIFY_TO. */
  get canSendContactNotification(): boolean {
    return this.resend !== null && this.notifyTo !== '';
  }

  /** Đủ điều kiện gửi email lời mời: Resend + ADMIN_APP_URL hợp lệ. */
  get canSendAccountInvitation(): boolean {
    return this.resend !== null && this.adminAppUrl !== '';
  }

  /**
   * Chuẩn hoá & kiểm tra ADMIN_APP_URL (biến không bí mật, chỉ ở backend):
   * - bắt buộc HTTPS ở production;
   * - cho phép http localhost khi dev/test;
   * - URL sai định dạng / sai giao thức → trả '' (email lời mời sẽ degrade
   *   thành no-op, giống khuôn xử lý thiếu cấu hình ở nơi khác).
   * Bỏ dấu `/` cuối để tránh nhân đôi khi ghép path.
   */
  private normalizeAdminAppUrl(raw: string | undefined): string {
    if (!raw) return '';
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      this.logger.warn(
        'ADMIN_APP_URL không hợp lệ — bỏ qua gửi email lời mời cho tới khi sửa.',
      );
      return '';
    }
    const isProd = (process.env.NODE_ENV ?? 'production') === 'production';
    const isLocalhost =
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (isProd && parsed.protocol !== 'https:') {
      this.logger.warn(
        'ADMIN_APP_URL phải dùng HTTPS ở production — bỏ qua gửi email lời mời.',
      );
      return '';
    }
    if (!isProd && parsed.protocol !== 'https:' && !isLocalhost) {
      this.logger.warn(
        'ADMIN_APP_URL http chỉ chấp nhận với localhost — bỏ qua gửi email lời mời.',
      );
      return '';
    }
    return raw.replace(/\/+$/, '');
  }

  /**
   * Gửi email báo có lead mới qua Resend. **Không bao giờ ném lỗi ra ngoài** —
   * lead đã được lưu DB nên gửi mail chỉ là phụ; lỗi được log lại (không kèm
   * cấu hình/secret) để lượt gửi hỏng không làm hỏng luồng tạo lead.
   */
  async sendContactNotification(data: ContactNotificationData): Promise<void> {
    const ref = data.submissionId ?? 'unknown';
    // Vừa để cảnh báo sớm, vừa để TypeScript thu hẹp kiểu `resend` khác null.
    const resend = this.resend;
    if (!resend || !this.notifyTo) {
      // Thiếu Resend hoặc CONTACT_NOTIFY_TO — bỏ qua, lead vẫn đã lưu.
      this.logger.warn(
        `Bỏ qua gửi email thông báo liên hệ: chưa đủ cấu hình (submissionId=${ref}).`,
      );
      return;
    }
    this.logger.log(
      `Bắt đầu gửi email thông báo liên hệ qua Resend (submissionId=${ref}).`,
    );
    try {
      const { data: sent, error } = await resend.emails.send({
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

  /**
   * Gửi email lời mời thiết lập tài khoản CMS. Cùng khuôn **không bao giờ ném
   * lỗi** như `sendContactNotification`: tài khoản + lời mời đã được lưu DB
   * trước khi gọi hàm này, nên gửi mail hỏng chỉ là phụ (SUPER_ADMIN có thể
   * gửi lại). KHÔNG log token, không log setup URL, không log payload email.
   */
  async sendAccountInvitation(data: AccountInvitationData): Promise<void> {
    // Điều kiện lời mời ĐỘC LẬP với CONTACT_NOTIFY_TO: chỉ cần Resend +
    // ADMIN_APP_URL. `const resend` cũng để TypeScript thu hẹp kiểu khác null.
    const resend = this.resend;
    if (!resend) {
      this.logger.warn(
        'Bỏ qua gửi email lời mời: Resend chưa cấu hình (tài khoản vẫn ở trạng thái chờ thiết lập).',
      );
      return;
    }
    if (!this.adminAppUrl) {
      this.logger.warn(
        'Bỏ qua gửi email lời mời: thiếu/không hợp lệ ADMIN_APP_URL.',
      );
      return;
    }

    // URL chứa token — chỉ dựng tại đây để nhúng vào email, KHÔNG log.
    const setupUrl = this.buildInvitationSetupUrl(data.token);
    this.logger.log(
      'Bắt đầu gửi email lời mời thiết lập tài khoản qua Resend.',
    );
    try {
      const { data: sent, error } = await resend.emails.send({
        from: this.from,
        to: data.to,
        subject: 'Thiết lập tài khoản quản trị CMS',
        text: this.buildInvitationText(data, setupUrl),
        html: this.buildInvitationHtml(data, setupUrl),
      });
      if (error) {
        // Chỉ log name/message của lỗi — không kèm recipient/URL/token.
        this.logger.error(
          `Gửi email lời mời qua Resend thất bại: ${error.name} - ${error.message}`,
        );
        return;
      }
      this.logger.log(
        `Đã gửi email lời mời qua Resend (messageId=${sent?.id ?? 'n/a'}).`,
      );
    } catch (error) {
      this.logger.error(
        `Gửi email lời mời qua Resend thất bại: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Dựng link thiết lập bằng URL API để token được mã hoá đúng chuẩn query. */
  private buildInvitationSetupUrl(token: string): string {
    const url = new URL(SETUP_PATH, `${this.adminAppUrl}/`);
    url.searchParams.set('token', token);
    return url.toString();
  }

  private buildInvitationText(
    data: AccountInvitationData,
    setupUrl: string,
  ): string {
    return [
      `Xin chào ${data.name},`,
      '',
      'Quản trị viên đã tạo cho bạn một tài khoản trên hệ thống quản trị (CMS) website Thiên Đức.',
      `Vai trò được cấp: ${ROLE_LABEL[data.role]}.`,
      '',
      'Vui lòng thiết lập mật khẩu để bắt đầu sử dụng bằng liên kết dưới đây:',
      setupUrl,
      '',
      `Liên kết này sẽ hết hạn sau 48 giờ (vào lúc ${VN_DATETIME.format(
        data.expiresAt,
      )} giờ VN).`,
      'Vì lý do an toàn, vui lòng KHÔNG chuyển tiếp email hay liên kết này cho người khác.',
      '',
      'Nếu bạn không rõ vì sao nhận được email này, vui lòng bỏ qua hoặc liên hệ quản trị viên.',
    ].join('\n');
  }

  private buildInvitationHtml(
    data: AccountInvitationData,
    setupUrl: string,
  ): string {
    return [
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#191919">',
      `<p>Xin chào <strong>${escapeHtml(data.name)}</strong>,</p>`,
      '<p>Quản trị viên đã tạo cho bạn một tài khoản trên hệ thống quản trị (CMS) website Thiên Đức.</p>',
      `<p>Vai trò được cấp: <strong>${escapeHtml(ROLE_LABEL[data.role])}</strong>.</p>`,
      `<p style="margin:24px 0"><a href="${escapeHtml(setupUrl)}" style="display:inline-block;padding:10px 20px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px">Thiết lập mật khẩu</a></p>`,
      `<p style="color:#59646a">Liên kết sẽ hết hạn sau 48 giờ (vào lúc ${VN_DATETIME.format(
        data.expiresAt,
      )} giờ VN). Vì lý do an toàn, vui lòng <strong>không chuyển tiếp</strong> email hay liên kết này cho người khác.</p>`,
      '<p style="color:#59646a">Nếu bạn không rõ vì sao nhận được email này, vui lòng bỏ qua hoặc liên hệ quản trị viên.</p>',
      '</div>',
    ].join('');
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
