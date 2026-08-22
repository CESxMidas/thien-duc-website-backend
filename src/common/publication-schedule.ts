import { ContentStatus } from '../../generated/prisma/client';

/**
 * **Các vị từ thuần về trạng thái lịch đăng** — dùng cho mọi model có bộ ba
 * `contentStatus` + `scheduledAt` + `publishedAt`.
 *
 * Khác `publication.ts` (vị từ *hiển thị công khai*, phải mang kiểu `where` của
 * đúng một model): những hàm dưới đây không chạm Prisma, chỉ đọc ba giá trị đã
 * nạp sẵn. Nhờ vậy chúng dùng chung được mà không làm yếu kiểu ở đâu cả.
 *
 * Gom về đây vì đây là phần **tinh tế nhất** của cả cơ chế hẹn giờ — đặc biệt
 * phép so `publishedAt === scheduledAt` để phân biệt một *dự định* chưa xảy ra
 * với *lịch sử xuất bản thật*. Mỗi bản sao của luật này là một cơ hội để hai
 * module trả lời khác nhau cho cùng một câu hỏi.
 *
 * ## Ghi chú về Dự án (Batch 13D)
 *
 * `projects.service.ts` từng giữ bản sao cục bộ của đúng các hàm này, viết
 * trước khi có file này; Batch 13D đã xoá bản sao đó và cho Dự án dùng thẳng
 * các hàm ở đây. Tin tức (`news.service.ts`) vẫn còn bản sao riêng — dọn ở đợt
 * sau.
 */

/** Bộ ba cột quyết định trạng thái lịch của một bản ghi. */
export interface ScheduleState {
  contentStatus: ContentStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
}

/** Bản ghi đã **thật sự** ra công khai bao giờ chưa (mốc nằm ở quá khứ)? */
export function hasBeenPublic(
  record: { publishedAt: Date | null },
  now: Date,
): boolean {
  return (
    record.publishedAt !== null && record.publishedAt.getTime() <= now.getTime()
  );
}

/**
 * Bản ghi có đang giữ một **lịch tương lai hợp lệ** không? (Đổi được, huỷ được.)
 *
 * Bốn điều kiện đều cần. `publishedAt` **đúng bằng** `scheduledAt` là dấu hiệu
 * mốc kia do chính lệnh đặt lịch ghi ra — một *dự định* chưa thành sự thật —
 * phân biệt với lịch sử xuất bản THẬT.
 */
export function isActiveFutureSchedule(
  record: ScheduleState,
  now: Date,
): boolean {
  return (
    record.contentStatus === ContentStatus.PENDING &&
    record.scheduledAt !== null &&
    record.publishedAt !== null &&
    record.scheduledAt.getTime() > now.getTime() &&
    record.publishedAt.getTime() === record.scheduledAt.getTime()
  );
}

/**
 * Bản ghi đã có **lịch sử xuất bản thật** chưa? Có `publishedAt`, và mốc đó
 * không phải dự định của một lịch tương lai đang chờ.
 */
export function hasHistoricalPublication(
  record: ScheduleState,
  now: Date,
): boolean {
  return record.publishedAt !== null && !isActiveFutureSchedule(record, now);
}

/**
 * **EDITOR có được sửa nội dung bản ghi này không?**
 *
 * Cho sửa nháp chưa từng công khai và bản chờ duyệt CHƯA hẹn giờ; chặn lịch
 * tương lai, lịch đã tới hạn, bản đang đăng, và nháp từng đăng.
 *
 * Không cần đồng hồ: lệnh đặt lịch ghi `publishedAt = scheduledAt`, nên chỉ cần
 * *sự tồn tại* của mốc là đủ để biết bản ghi đã rời khỏi khâu biên tập. Nhờ thế
 * hàm này không thể cho ra hai câu trả lời khác nhau ở hai thời điểm gần nhau.
 */
export function editorMayEditScheduled(record: ScheduleState): boolean {
  if (record.publishedAt !== null) return false;
  if (record.contentStatus === ContentStatus.DRAFT) return true;
  return (
    record.contentStatus === ContentStatus.PENDING &&
    record.scheduledAt === null
  );
}

/**
 * `scheduledAt` phải bị xoá khi đổi trạng thái **thủ công** sang PUBLISHED hoặc
 * DRAFT — trả `null` để xoá, `undefined` để không đụng tới cột.
 *
 * PENDING cố ý KHÔNG xoá: "đã lên lịch" chính là `PENDING` + `scheduledAt`.
 */
export function clearedSchedule(next: ContentStatus): null | undefined {
  return next === ContentStatus.PUBLISHED || next === ContentStatus.DRAFT
    ? null
    : undefined;
}

/**
 * `publishedAt` cho một lần đổi trạng thái **thủ công**. Ba nhánh:
 *
 * - **Đăng ngay một bản đang hẹn lịch chưa tới hạn.** Lệnh đặt lịch đã ghi
 *   `publishedAt = scheduledAt` ở **tương lai**. Giữ nguyên mốc đó thì bản vừa
 *   bấm đăng lại mang mốc công khai nằm ở ngày mai. Bấm "Đăng ngay" nghĩa là
 *   công khai **bây giờ** — lần công khai theo lịch kia đã không xảy ra.
 * - **Đăng một bản chưa từng có mốc nào** → `now`.
 * - **Đăng lại một bản từng công khai thật** → giữ mốc lịch sử.
 *
 * Với DRAFT: xoá `publishedAt` **chỉ khi** nó nằm ở tương lai — tức bản ghi
 * chưa từng công khai, mốc đó chỉ là ý định. Bản đã thật sự công khai (kể cả
 * bản tới hạn mà reconciler chưa chạm tới, vốn đã hiển thị qua vị từ hiển thị)
 * giữ nguyên mốc: nó **đã** ra ngoài, xoá đi là xoá mất sự thật đó.
 */
export function publishedAtFor(
  record: { publishedAt: Date | null },
  next: ContentStatus,
  now: Date,
): Date | null | undefined {
  if (next === ContentStatus.PUBLISHED) {
    return hasBeenPublic(record, now) ? record.publishedAt : now;
  }
  if (next === ContentStatus.DRAFT) {
    return hasBeenPublic(record, now) ? record.publishedAt : null;
  }
  // PENDING: không đụng tới mốc công khai.
  return record.publishedAt;
}
