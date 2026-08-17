import { ForbiddenException } from '@nestjs/common';
import { ContentStatus, Role } from '../../generated/prisma/client';
import { assertContentStatusTransition } from './content-approval';

/**
 * ADMIN-CONTENT-STATUS-WORKFLOW-CONSISTENCY-M1: luật chuyển trạng thái dùng chung
 * cho cả bốn module (News, Projects, Pages, Cooperation). Vì các service đều gọi
 * `assertContentStatusTransition`, test ở đây bao trọn phần logic phân quyền mịn.
 */
describe('assertContentStatusTransition', () => {
  it('SUPER_ADMIN: đặt trạng thái đích nào cũng được', () => {
    expect(() =>
      assertContentStatusTransition(
        Role.SUPER_ADMIN,
        ContentStatus.DRAFT,
        ContentStatus.PUBLISHED,
      ),
    ).not.toThrow();
    expect(() =>
      assertContentStatusTransition(
        Role.SUPER_ADMIN,
        ContentStatus.PENDING,
        ContentStatus.PUBLISHED,
      ),
    ).not.toThrow();
    expect(() =>
      assertContentStatusTransition(
        Role.SUPER_ADMIN,
        ContentStatus.PUBLISHED,
        ContentStatus.DRAFT,
      ),
    ).not.toThrow();
  });

  it('ADMIN: đăng thẳng từ nháp, duyệt & đăng, trả về nháp đều được', () => {
    // Option B (ADMIN-CONTENT-WORKFLOW-BUSINESS-RULE-AUDIT-M1): ADMIN đăng thẳng
    // DRAFT → PUBLISHED, không phải tự gửi duyệt nội dung của chính mình.
    expect(() =>
      assertContentStatusTransition(
        Role.ADMIN,
        ContentStatus.DRAFT,
        ContentStatus.PUBLISHED,
      ),
    ).not.toThrow();
    expect(() =>
      assertContentStatusTransition(
        Role.ADMIN,
        ContentStatus.PENDING,
        ContentStatus.PUBLISHED,
      ),
    ).not.toThrow();
    expect(() =>
      assertContentStatusTransition(
        Role.ADMIN,
        ContentStatus.PUBLISHED,
        ContentStatus.DRAFT,
      ),
    ).not.toThrow();
  });

  it('EDITOR: chỉ được gửi duyệt (DRAFT → PENDING)', () => {
    expect(() =>
      assertContentStatusTransition(
        Role.EDITOR,
        ContentStatus.DRAFT,
        ContentStatus.PENDING,
      ),
    ).not.toThrow();
  });

  it('EDITOR: không được đăng thẳng / duyệt / trả nháp → 403', () => {
    const blocked: [ContentStatus, ContentStatus][] = [
      [ContentStatus.DRAFT, ContentStatus.PUBLISHED],
      [ContentStatus.PENDING, ContentStatus.PUBLISHED],
      [ContentStatus.PUBLISHED, ContentStatus.DRAFT],
    ];
    for (const [from, to] of blocked) {
      expect(() =>
        assertContentStatusTransition(Role.EDITOR, from, to),
      ).toThrow(ForbiddenException);
    }
  });

  it('Vai trò không xác định: chặn mọi chuyển tiếp → 403', () => {
    expect(() =>
      assertContentStatusTransition(
        undefined,
        ContentStatus.DRAFT,
        ContentStatus.PENDING,
      ),
    ).toThrow(ForbiddenException);
  });

  /**
   * So khớp chuỗi vai trò phải ĐÚNG TUYỆT ĐỐI. Trước đây tính chất này được
   * khoá qua `canBypassApproval`; helper đó đã bị gỡ ở batch chuẩn hoá vòng đời
   * tạo nội dung, nên chuyển phép kiểm sang đây — nơi giờ là chốt quyền duy
   * nhất. Một biến thể sai chính tả lọt qua là mở toang quyền đăng bài.
   */
  it('biến thể sai chính tả của vai trò KHÔNG được coi là quản trị → 403', () => {
    for (const role of ['super_admin', 'SUPERADMIN', 'Admin', 'admin', '']) {
      expect(() =>
        assertContentStatusTransition(
          role,
          ContentStatus.DRAFT,
          ContentStatus.PUBLISHED,
        ),
      ).toThrow(ForbiddenException);
    }
  });
});
