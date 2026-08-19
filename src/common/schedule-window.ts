import { BadRequestException } from '@nestjs/common';

/**
 * **Cửa sổ thời gian hợp lệ cho một lịch đăng** — dùng chung cho mọi nội dung
 * có hẹn giờ (tin tức từ Batch 3, dự án từ Batch 9).
 *
 * Tách ra khỏi `news.service.ts` khi dự án cần đúng luật đó: hai ngưỡng này là
 * **hợp đồng với người dùng cuối** (Admin CMS chép lại cả hai để cảnh báo tại
 * chỗ, xem `lib/news-schedule.ts`), nên hai bản sao lệch nhau sẽ tạo ra thứ tệ
 * nhất — form báo hợp lệ rồi backend từ chối, hoặc ngược lại.
 *
 * Chỉ gom phần **thật sự chung**. Điều kiện *bản ghi nào được phép hẹn giờ*
 * (từng công khai chưa, đang ở trạng thái nào) thì KHÔNG chung: nó phụ thuộc cột
 * của từng model và nằm lại ở service tương ứng.
 */

/** Lịch phải cách hiện tại ít nhất chừng này — dưới ngưỡng thì dùng "Đăng ngay". */
export const MIN_SCHEDULE_LEAD_MS = 60_000;

/** Trần 2 năm — chủ yếu để bắt lỗi gõ nhầm năm, thứ hay xảy ra nhất. */
export const MAX_SCHEDULE_HORIZON_MS = 2 * 365 * 24 * 60 * 60 * 1000;

/**
 * Ném `BadRequestException` nếu mốc hẹn nằm ngoài cửa sổ cho phép.
 *
 * Nhận `now` từ lời gọi thay vì tự tạo: service phải dùng **một** mốc hiện tại
 * duy nhất cho cả kiểm tra lẫn ghi, nếu không một lịch sát ngưỡng có thể qua
 * được validate rồi ghi xuống ở trạng thái không hợp lệ.
 */
export function assertScheduleWindow(scheduledAt: Date, now: Date): void {
  const leadMs = scheduledAt.getTime() - now.getTime();

  if (leadMs < MIN_SCHEDULE_LEAD_MS) {
    throw new BadRequestException(
      'Thời điểm đăng phải ở tương lai, cách hiện tại ít nhất 1 phút. Dùng "Đăng ngay" nếu muốn đăng lúc này.',
    );
  }
  if (leadMs > MAX_SCHEDULE_HORIZON_MS) {
    throw new BadRequestException(
      'Thời điểm đăng quá xa (tối đa 2 năm). Hãy kiểm tra lại năm.',
    );
  }
}
