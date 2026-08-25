import { ForbiddenException } from '@nestjs/common';
import { Role } from '../../generated/prisma/client';

/**
 * **Chốt quyền SỬA NỘI DUNG theo trạng thái xuất bản hiện tại.**
 *
 * Song song với `assertContentStatusTransition` (quyền *đổi trạng thái*), đây là
 * quyền *sửa nội dung*. Hai thứ khác nhau, và trước batch này chỉ có cái thứ
 * nhất được chốt — nên còn một lỗ hổng quản trị đo được ở News:
 *
 * ```
 * 07:00  ADMIN đặt lịch đăng bài lúc 08:00   (PENDING + scheduledAt)
 * 07:59  EDITOR sửa nội dung bài đó           ← route PATCH :slug mở cho EDITOR
 * 08:00  bản ĐÃ SỬA tự động ra công khai
 * ```
 *
 * Tức là bản mà ADMIN duyệt/hẹn giờ **không** được bảo đảm là bản ra công khai.
 * Cùng một lỗ hổng, dạng nhẹ hơn, ở Project/Cooperation/Page: EDITOR sửa được
 * nội dung đang hiển thị trên website mà không ai duyệt lại. Nay **cả bốn**
 * module đều đi qua chốt này.
 *
 * ## Luật
 *
 * - **ADMIN / SUPER_ADMIN**: giữ NGUYÊN quyền sửa hiện có, ở mọi trạng thái.
 *   Đây là luồng sửa gấp/đính chính của quản trị — siết nó lại là làm hỏng một
 *   nghiệp vụ đang dùng, không phải vá lỗ hổng.
 * - **EDITOR**: chỉ sửa được nội dung còn **thật sự đang trong khâu biên tập**.
 *   "Thật sự" là do từng module định nghĩa (tham số `editorMayEdit`), vì điều
 *   kiện phụ thuộc những cột mà module đó có.
 * - **Vai trò khác / thiếu / sai chính tả**: chặn. `RolesGuard` đã lọc trước
 *   một lớp; ở đây fail closed, một biến thể `'Admin'` không được thành ADMIN.
 *
 * ## Vì sao nhận `boolean` chứ không nhận bản ghi
 *
 * Ranh giới trách nhiệm: file này sở hữu **bậc thang vai trò**, còn việc đọc
 * trạng thái lịch của bản ghi thuộc về `publication-schedule.ts`. Nhận sẵn một
 * `boolean` giữ hai mối bận tâm đó tách nhau — hàm này không cần biết model nào
 * đặt tên cột ra sao (`status` ở News/Page, `contentStatus` ở Project), cũng
 * không phải nạp thêm cột nào để trả lời câu hỏi về vai trò.
 *
 * Hiện cả bốn module đều truyền vào `editorMayEditScheduled` (vị từ dùng chung
 * ở `publication-schedule.ts`), nhưng chữ ký vẫn để ngỏ `boolean` để một module
 * có luật riêng không phải phá vỡ chốt vai trò này.
 *
 * Thông điệp từ chối do lời gọi truyền vào để mỗi module gọi đúng tên nội dung
 * ("Bài viết" / "Dự án" / "Trang"), thứ mà Admin CMS hiện thẳng cho người dùng.
 */
export function assertContentEditAllowed(
  role: string | undefined | null,
  editorMayEdit: boolean,
  denialMessage: string,
): void {
  if (role === Role.ADMIN || role === Role.SUPER_ADMIN) return;
  if (role === Role.EDITOR && editorMayEdit) return;

  throw new ForbiddenException(denialMessage);
}
