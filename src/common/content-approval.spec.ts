import { ForbiddenException } from '@nestjs/common';
import { ContentStatus, Role } from '../../generated/prisma/client';
import {
  assertContentStatusTransition,
  canBypassApproval,
  initialContentStatus,
} from './content-approval';

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
});
