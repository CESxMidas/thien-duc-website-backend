import { Injectable } from '@nestjs/common';

/**
 * Loại email được ghi lại trong outbox test — khớp ba luồng gửi của MailService.
 */
export type OutboxMailType = 'contact' | 'invitation' | 'password-reset';

/**
 * Một email đã bị "gửi" trong chế độ transport giả (chỉ test). `url` chứa link
 * thiết lập/đặt lại (kèm token bản rõ) để test trích ra — KHÔNG bao giờ được log.
 */
export interface OutboxEntry {
  id: string;
  type: OutboxMailType;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Link kèm token (invitation/reset). null với email liên hệ (không có link). */
  url: string | null;
  createdAt: string;
}

/**
 * Hộp thư giả trong bộ nhớ — CHỈ dùng cho E2E cục bộ. Không ghi ra đĩa, không
 * gọi mạng, reset sạch giữa các test qua `clear()`. Bản thân service này trơ (chỉ
 * là kho chứa) nên an toàn khi để trong DI; điểm nhạy cảm là endpoint HTTP đọc nó
 * — endpoint đó bị chặn cứng ở TestSupportModule + TestOnlyGuard (chỉ NODE_ENV=test
 * + cờ MAIL_FAKE_TRANSPORT=1 + localhost).
 */
@Injectable()
export class MailOutboxService {
  private readonly entries: OutboxEntry[] = [];
  private counter = 0;
  /** Giả lập nhà cung cấp email lỗi (chỉ ảnh hưởng email liên hệ). */
  private failMode = false;

  /** Bật/tắt chế độ giả lập lỗi provider cho email liên hệ. */
  setFailMode(enabled: boolean): void {
    this.failMode = enabled;
  }

  isFailMode(): boolean {
    return this.failMode;
  }

  /** Ghi một email vào outbox, trả về bản ghi đã tạo (kèm id + thời điểm). */
  record(entry: Omit<OutboxEntry, 'id' | 'createdAt'>): OutboxEntry {
    const full: OutboxEntry = {
      ...entry,
      id: `outbox-${++this.counter}`,
      createdAt: new Date().toISOString(),
    };
    this.entries.push(full);
    return full;
  }

  /** Liệt kê email đã ghi, mới nhất trước; lọc theo người nhận nếu truyền `to`. */
  list(to?: string): OutboxEntry[] {
    const all = to
      ? this.entries.filter(
          (e) => e.to.toLowerCase() === to.toLowerCase().trim(),
        )
      : this.entries;
    return [...all].reverse();
  }

  /** Xóa sạch outbox + tắt fail-mode — gọi giữa các test để cô lập trạng thái. */
  clear(): void {
    this.entries.length = 0;
    this.failMode = false;
  }
}
