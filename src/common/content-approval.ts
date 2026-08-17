import { ForbiddenException } from '@nestjs/common';
import { ContentStatus, Role } from '../../generated/prisma/client';

/**
 * Luồng duyệt nội dung của Admin CMS đi theo bậc thang `DRAFT → PENDING →
 * PUBLISHED`. Nội dung mới **luôn** bắt đầu ở `DRAFT`, với mọi vai trò — không
 * còn helper `initialContentStatus(role)` / `canBypassApproval(role)` nào ở đây.
 *
 * Vì sao bỏ hẳn: hai hàm đó gộp **quyền được đăng** với **mặc định sau khi
 * tạo**. SUPER_ADMIN có quyền đăng, nhưng "tạo nội dung" và "quyết định cho nội
 * dung ra công khai" là hai việc khác nhau, và gộp lại làm mất cả khả năng hẹn
 * giờ cho chính nội dung của họ (đã đo được ở News: bài vừa tạo đã công khai
 * nên không đặt lịch được nữa). Nay mỗi service tự ghi `DRAFT` tường minh, còn
 * việc công khai đi qua đúng một cửa: route `.../status` bên dưới.
 *
 * Giữ một hàm trả về hằng số `DRAFT` nhưng vẫn nhận tham số `role` sẽ là cái
 * bẫy: đọc chữ ký thì tưởng có luật theo vai trò, đọc thân hàm mới biết không.
 */

/**
 * Chốt quyền **đổi trạng thái** nội dung, dùng chung cho mọi module (News,
 * Projects, Pages, Cooperation) để không lặp lại luật ở từng service. Đây là
 * lớp chốt mịn nằm sau `RolesGuard`: guard chỉ cho phép EDITOR/ADMIN/SUPER_ADMIN
 * gọi route `.../status`, còn hàm này quyết định *chuyển sang trạng thái nào* thì
 * hợp lệ với vai trò đó.
 *
 * - **ADMIN / SUPER_ADMIN**: giữ nguyên quyền duyệt hiện có — đặt trạng thái đích
 *   nào cũng được (kể cả SUPER_ADMIN đăng thẳng `DRAFT → PUBLISHED`). Không nới
 *   thêm cũng không siết bớt so với hành vi cũ.
 * - **EDITOR (và vai trò thấp hơn)**: chỉ được **gửi bản nháp đi duyệt**
 *   (`DRAFT → PENDING`). Mọi chuyển tiếp khác — nhất là đăng thẳng — bị chặn 403.
 *
 * Ném `ForbiddenException` để Nest trả 403 khi vai trò không được phép.
 */
export function assertContentStatusTransition(
  role: string | undefined | null,
  current: ContentStatus,
  next: ContentStatus,
): void {
  if (role === Role.ADMIN || role === Role.SUPER_ADMIN) return;

  if (
    role === Role.EDITOR &&
    current === ContentStatus.DRAFT &&
    next === ContentStatus.PENDING
  ) {
    return;
  }

  throw new ForbiddenException('Bạn không có quyền chuyển sang trạng thái này');
}
