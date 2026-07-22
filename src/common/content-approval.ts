import { ForbiddenException } from '@nestjs/common';
import { ContentStatus, Role } from '../../generated/prisma/client';

/**
 * Luồng duyệt nội dung của Admin CMS đi theo bậc thang trạng thái
 * `DRAFT → PENDING → PUBLISHED`: nội dung mới lưu nháp, nhân viên gửi duyệt, rồi
 * Admin duyệt & đăng. SUPER_ADMIN là vai trò cao nhất nên **bỏ qua** luồng này
 * cho chính thao tác của họ — không phải tự duyệt nội dung mình vừa tạo.
 *
 * Vai trò thấp hơn (EDITOR, ADMIN) giữ nguyên quy trình cũ. Helper nhận `role`
 * dạng chuỗi (khớp payload JWT `req.user.role`) để controller truyền thẳng
 * `user.role` mà không cần ép kiểu.
 */
export function canBypassApproval(role?: string | null): boolean {
  return role === Role.SUPER_ADMIN;
}

/**
 * Trạng thái khởi tạo khi **tạo mới** nội dung: SUPER_ADMIN đăng ngay
 * (`PUBLISHED`), các vai trò khác lưu nháp (`DRAFT`) rồi đi theo luồng duyệt.
 */
export function initialContentStatus(role?: string | null): ContentStatus {
  return canBypassApproval(role)
    ? ContentStatus.PUBLISHED
    : ContentStatus.DRAFT;
}

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
