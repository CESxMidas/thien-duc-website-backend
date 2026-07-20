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
