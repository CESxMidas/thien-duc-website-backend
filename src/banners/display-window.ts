import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

/**
 * **CỬA SỔ HIỂN THỊ BANNER — nguồn sự thật duy nhất.**
 *
 * Đây KHÔNG phải lịch xuất bản. Tin tức / dự án / trang / dự án hợp tác có vòng
 * đời `DRAFT → PENDING → PUBLISHED` cộng một reconciler đổi trạng thái khi tới
 * hạn; banner thì không, và cố tình không có. Hai mốc dưới đây chỉ là **cấu hình
 * khoảng thời gian banner đủ điều kiện xuất hiện**, xét hoàn toàn lúc truy vấn:
 * không cron, không mutation tại mốc đáo hạn, không enum trạng thái mới.
 *
 * Vì mọi thứ nằm ở vị từ truy vấn nên tính đúng đắn không phụ thuộc tiến trình:
 * backend trên Render Free ngủ suốt cả cửa sổ vẫn trả đúng tập banner ngay ở
 * request đầu tiên sau khi thức dậy.
 *
 * ## Khoảng nửa mở `[displayFrom, displayUntil)`
 *
 * ```
 * (displayFrom  IS NULL OR displayFrom  <= now)
 * AND
 * (displayUntil IS NULL OR displayUntil >  now)
 * ```
 *
 * Đúng tại `displayFrom` → HIỆN. Đúng tại `displayUntil` → TẮT. Chọn nửa mở chứ
 * không phải hai đầu đóng vì banner thường được xếp nối đuôi nhau: banner A kết
 * thúc đúng lúc banner B bắt đầu. Với hai đầu đóng, giây giao nhau đó có hai
 * banner cùng đủ điều kiện — mơ hồ ngay tại thời điểm dễ bị soi nhất.
 *
 * ## Đồng hồ
 *
 * Mốc so sánh là `Date` của tiến trình Node do lời gọi truyền vào, KHÔNG phải
 * `NOW()` của Postgres. Cột là `timestamp WITHOUT time zone` chứa giờ UTC, còn
 * `NOW()` trả `timestamptz` — so trực tiếp hai kiểu đó sẽ bị quy đổi theo
 * `TimeZone` của phiên và lệch đúng bằng offset (xem
 * `test/scheduler-utc.e2e-spec.ts`). Giá trị `Date` của JS đi qua bind parameter
 * của Prisma thì luôn là một instant tuyệt đối, không phụ thuộc múi giờ phiên.
 *
 * Mỗi thao tác chỉ tạo `now` MỘT lần rồi truyền xuống mọi truy vấn con.
 */

/** Hình dạng tối thiểu để xét cửa sổ hiển thị. */
export interface DisplayWindow {
  displayFrom: Date | null;
  displayUntil: Date | null;
}

/**
 * Mảnh `where` cho Prisma — chỉ phần THỜI GIAN.
 *
 * Cố ý không gộp luôn `isActive`: công tắc thủ công và điều kiện thời gian là
 * hai khái niệm tách bạch (xem `bannerPubliclyVisibleWhere`), và ghép chúng ở
 * đây sẽ khiến hàm này không dùng lại được cho các phép kiểm chỉ về thời gian.
 */
export function withinDisplayWindowWhere(now: Date): Prisma.BannerWhereInput {
  return {
    AND: [
      { OR: [{ displayFrom: null }, { displayFrom: { lte: now } }] },
      { OR: [{ displayUntil: null }, { displayUntil: { gt: now } }] },
    ],
  };
}

/**
 * Vị từ hiển thị công khai ĐẦY ĐỦ của banner.
 *
 * `isActive` là công tắc thủ công và vẫn giữ quyền phủ quyết: banner đang tắt
 * thì ẩn bất kể cửa sổ thời gian có hợp lệ hay không. Cửa sổ chỉ THU HẸP thêm,
 * không bao giờ mở rộng ra.
 *
 * Hàng dị dạng do sửa tay dưới DB (`display_from > display_until`) tự nhiên
 * không bao giờ hiện: không tồn tại `now` nào vừa `>= display_from` vừa
 * `< display_until`. Không cần cơ chế sửa chữa lúc chạy.
 */
export function bannerPubliclyVisibleWhere(now: Date): Prisma.BannerWhereInput {
  return { isActive: true, ...withinDisplayWindowWhere(now) };
}

/** Bản trên bản ghi đã nạp — cùng luật với `withinDisplayWindowWhere`. */
export function isWithinDisplayWindow(
  window: DisplayWindow,
  now: Date,
): boolean {
  const ms = now.getTime();
  if (window.displayFrom !== null && window.displayFrom.getTime() > ms) {
    return false;
  }
  if (window.displayUntil !== null && window.displayUntil.getTime() <= ms) {
    return false;
  }
  return true;
}

/**
 * Cửa sổ hợp lệ chưa? Ném `BadRequestException` nếu không.
 *
 * Luật duy nhất: khi có ĐỦ CẢ HAI biên thì `displayFrom < displayUntil`. Bằng
 * nhau cũng bị từ chối — với khoảng nửa mở, `from == until` là một cửa sổ rỗng
 * tuyệt đối, gần như chắc chắn là gõ nhầm chứ không phải ý định.
 *
 * ## Ba luật CỐ Ý KHÔNG áp ở đây
 *
 * 1. **Không có ngưỡng "cách hiện tại tối thiểu 1 phút"** (`MIN_SCHEDULE_LEAD_MS`
 *    của `common/schedule-window.ts`). Ngưỡng đó tồn tại vì đặt lịch đăng là một
 *    *mệnh lệnh* — hẹn sát quá thì đã có nút "Đăng ngay" đúng nghĩa hơn. Cửa sổ
 *    hiển thị là *cấu hình*: "hiện từ bây giờ tới 30 phút nữa" là yêu cầu hoàn
 *    toàn chính đáng cho một banner sự kiện.
 * 2. **Không có trần 2 năm.** Banner mùa vụ đặt trước cho vài năm sau là bình
 *    thường; trần đó sinh ra để bắt lỗi gõ nhầm năm ở luồng đăng bài, không phải
 *    một yêu cầu nghiệp vụ của banner.
 * 3. **Không cấm mốc quá khứ.** Cả hai biên đều được phép nằm ở quá khứ: đó
 *    chính là cách mô tả một banner đã hết hạn mà vẫn giữ lại để dùng lại sau.
 */
export function assertDisplayWindow(window: DisplayWindow): void {
  const { displayFrom, displayUntil } = window;
  if (displayFrom === null || displayUntil === null) return;

  if (displayFrom.getTime() >= displayUntil.getTime()) {
    throw new BadRequestException(
      '“Hiển thị đến” phải sau “Hiển thị từ”. Hãy kiểm tra lại hai mốc thời gian.',
    );
  }
}

/**
 * Một biên đến từ DTO. Ba giá trị mang ba ý nghĩa KHÁC NHAU và không được lẫn:
 *
 * - `undefined` — client không gửi field ⇒ GIỮ NGUYÊN giá trị đang lưu.
 * - `null`      — client gửi tường minh `null` ⇒ XOÁ biên.
 * - `string`    — instant ISO có múi giờ ⇒ ĐẶT biên mới.
 *
 * JSON không biểu diễn được `undefined`, nên phân biệt bằng `=== undefined` là
 * chính xác tuyệt đối — không cần tới `in` (vốn phụ thuộc việc class-transformer
 * có tạo own property hay không).
 */
export type DisplayBoundInput = string | null | undefined;

/** `undefined` giữ nguyên `current`; `null` xoá; chuỗi ISO thành `Date`. */
function resolveBound(
  incoming: DisplayBoundInput,
  current: Date | null,
): Date | null {
  if (incoming === undefined) return current;
  if (incoming === null) return null;
  return new Date(incoming);
}

/**
 * Trộn cửa sổ đang lưu với thay đổi đến từ PATCH rồi trả về **trạng thái cuối**.
 *
 * Đây là điểm mấu chốt của tính đúng đắn ở PATCH: chỉ kiểm hai field trong DTO
 * là chưa đủ. Bản ghi đang có `[10/09, 20/09]`, PATCH gửi mỗi
 * `displayFrom = 25/09` — bản thân DTO không có gì sai, nhưng trạng thái SAU KHI
 * ghi lại là `[25/09, 20/09]`, một cửa sổ không bao giờ hiện. Luôn kiểm trên kết
 * quả trộn, không kiểm trên phần gửi lên.
 */
export function mergeDisplayWindow(
  current: DisplayWindow,
  incoming: {
    displayFrom?: DisplayBoundInput;
    displayUntil?: DisplayBoundInput;
  },
): DisplayWindow {
  return {
    displayFrom: resolveBound(incoming.displayFrom, current.displayFrom),
    displayUntil: resolveBound(incoming.displayUntil, current.displayUntil),
  };
}

/** Cửa sổ rỗng — điểm xuất phát khi tạo mới (chưa có gì đang lưu). */
export const EMPTY_DISPLAY_WINDOW: DisplayWindow = {
  displayFrom: null,
  displayUntil: null,
};
