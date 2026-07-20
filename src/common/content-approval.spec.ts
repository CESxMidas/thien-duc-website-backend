import { ContentStatus, Role } from '../../generated/prisma/client';
import { canBypassApproval, initialContentStatus } from './content-approval';

/**
 * ADMIN-SUPER-ADMIN-GLOBAL-APPROVAL-BYPASS-M1: helper chung quyết định vai trò
 * nào bỏ qua luồng duyệt nội dung. Chỉ SUPER_ADMIN (khớp đúng chuỗi enum) được
 * bỏ qua; EDITOR/ADMIN giữ nguyên luồng nháp → chờ duyệt.
 */
describe('content-approval helper', () => {
  it('canBypassApproval: chỉ SUPER_ADMIN true', () => {
    expect(canBypassApproval(Role.SUPER_ADMIN)).toBe(true);
    expect(canBypassApproval(Role.ADMIN)).toBe(false);
    expect(canBypassApproval(Role.EDITOR)).toBe(false);
    expect(canBypassApproval(undefined)).toBe(false);
    expect(canBypassApproval(null)).toBe(false);
    // Không khớp biến thể sai chính tả — tránh bỏ qua duyệt nhầm.
    expect(canBypassApproval('super_admin')).toBe(false);
    expect(canBypassApproval('SUPERADMIN')).toBe(false);
  });

  it('initialContentStatus: SUPER_ADMIN → PUBLISHED, còn lại → DRAFT', () => {
    expect(initialContentStatus(Role.SUPER_ADMIN)).toBe(
      ContentStatus.PUBLISHED,
    );
    expect(initialContentStatus(Role.ADMIN)).toBe(ContentStatus.DRAFT);
    expect(initialContentStatus(Role.EDITOR)).toBe(ContentStatus.DRAFT);
    expect(initialContentStatus(undefined)).toBe(ContentStatus.DRAFT);
  });
});
