import { ForbiddenException } from '@nestjs/common';
import { ContentStatus, Role } from '../../generated/prisma/client';

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
 * nội dung đang hiển thị trên website mà không ai duyệt lại.
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
 * Điều kiện của EDITOR **không** dùng chung được: News xét thêm `scheduledAt` /
 * `publishedAt`, ba module còn lại chưa có hai cột đó. Nhét luật lịch của News
 * vào một hàm generic sẽ hoặc đòi mọi module giả lập hai cột không tồn tại,
 * hoặc dựng một lớp trừu tượng bịt mất chính chỗ khác biệt quan trọng nhất.
 * Nên phần *dùng chung* (bậc thang vai trò) nằm ở đây, phần *riêng theo trạng
 * thái* nằm cạnh dữ liệu của từng module.
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

/**
 * Vị từ EDITOR cho các module **chưa có cột lịch sử xuất bản** — Project,
 * CooperationProject, Page: sửa được khi còn `DRAFT` hoặc `PENDING`, không sửa
 * được khi đã `PUBLISHED`.
 *
 * ## Giới hạn đã biết (cố ý)
 *
 * Ba model này không có `publishedAt` lẫn `scheduledAt`, nên **không phân biệt
 * được** hai bản ghi cùng mang `DRAFT`:
 *
 * - bản nháp chưa từng công khai, và
 * - bản đã đăng rồi bị ADMIN gỡ về nháp.
 *
 * News phân biệt được nhờ `publishedAt`, và luật của News siết đúng theo đó.
 * Ở đây thì trạng thái lưu trữ không mang đủ thông tin, mà **bịa ra lịch sử là
 * việc tệ hơn**: suy đoán từ `updatedAt` sẽ sai với mọi bản ghi cũ và sai theo
 * hướng khó thấy. Batch này lấy đúng phần chắc chắn — chặn sửa nội dung ĐANG
 * hiển thị công khai. Khi nào ba module có cột lịch sử xuất bản thật thì siết
 * tiếp cho khớp News.
 */
export function editorMayEditUnpublished(status: ContentStatus): boolean {
  return status === ContentStatus.DRAFT || status === ContentStatus.PENDING;
}
