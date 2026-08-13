import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Mốc thời gian **tuyệt đối**: ISO-8601 có ngày, giờ, và **múi giờ tường minh**
 * (`Z` hoặc `+HH:MM` / `-HH:MM`).
 *
 * Vì sao không dùng `@IsDateString()`: nó chấp nhận `2026-08-20T08:00` — một
 * chuỗi **không mang múi giờ**. `new Date()` sẽ diễn giải chuỗi đó theo múi giờ
 * của **tiến trình đang chạy**. Backend chạy UTC trên Render, máy biên tập viên
 * chạy UTC+7: cùng một payload cho ra hai thời điểm cách nhau 7 tiếng, và không
 * bên nào báo lỗi. Với một field quyết định *khi nào nội dung ra công khai*,
 * kiểu mơ hồ đó là không chấp nhận được.
 *
 * HỢP ĐỒNG: **từ chối, không suy đoán.** Client phải nói rõ ý mình —
 * `2026-08-20T08:00:00+07:00` (08:00 giờ Việt Nam) hoặc `2026-08-20T01:00:00Z`.
 * Hai chuỗi đó là **cùng một instant** và lưu xuống DB giống hệt nhau.
 *
 * Kiểm ba lớp:
 *  1. Hình dạng chuỗi phải khớp regex — chốt sự hiện diện của offset, thứ mà
 *     `Date.parse` không cho biết sau khi đã phân giải xong.
 *  2. `Date.parse` phải ra số hợp lệ — loại giờ 25, offset +99:00.
 *  3. Ngày phải **có thật trên lịch**. V8 âm thầm cuộn `2026-02-31` thành
 *     `2026-03-03` thay vì trả `NaN`, nên hai lớp trên không đủ: một biên tập
 *     viên gõ nhầm ngày sẽ thấy bài lên muộn ba ngày mà không hề có báo lỗi.
 */

/**
 * `YYYY-MM-DD` `T` `HH:MM` [`:SS` [`.mmm`]] rồi `Z` | `±HH:MM`.
 *
 * Giây và mili giây tuỳ chọn (ISO-8601 cho phép), nhưng **offset thì bắt buộc**
 * — đó là toàn bộ lý do regex này tồn tại. Dấu cách thay cho `T` cũng bị loại:
 * `2026-08-20 08:00:00+07:00` là biến thể của SQL, không phải ISO-8601.
 */
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Ngày lịch có thật không? Kiểm riêng phần `YYYY-MM-DD`, độc lập với giờ và
 * offset — nếu dựng bằng `Date.UTC` rồi đọc lại mà lệch, ngày đó đã bị cuộn.
 */
function isRealCalendarDate(datePart: string): boolean {
  const [year, month, day] = datePart.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** True nếu chuỗi là một instant ISO-8601 có múi giờ tường minh và giá trị hợp lệ. */
export function isIsoInstant(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (!ISO_INSTANT.test(value)) return false;
  if (Number.isNaN(Date.parse(value))) return false;
  return isRealCalendarDate(value.slice(0, 10));
}

/** Field mốc thời gian tuyệt đối — bắt buộc kèm `Z` hoặc `±HH:MM`. */
export function IsIsoInstant(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isIsoInstant',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => isIsoInstant(value),
        defaultMessage: () =>
          `${propertyName} phải là mốc thời gian ISO-8601 kèm múi giờ, ví dụ 2026-08-20T08:00:00+07:00`,
      },
    });
  };
}
