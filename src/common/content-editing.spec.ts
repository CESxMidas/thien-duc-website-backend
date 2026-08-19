import { ForbiddenException } from '@nestjs/common';
import { ContentStatus, Role } from '../../generated/prisma/client';
import {
  assertContentEditAllowed,
  editorMayEditUnpublished,
} from './content-editing';

/**
 * Bậc thang vai trò của quyền **sửa nội dung** (Batch 8), dùng chung cho cả bốn
 * module. Vì mọi service đều đi qua `assertContentEditAllowed`, test ở đây bao
 * trọn phần phân quyền theo vai trò; phần điều kiện theo trạng thái được khoá ở
 * spec của từng module (News có thêm lịch, ba module còn lại thì không).
 */
describe('assertContentEditAllowed', () => {
  const MESSAGE = 'Không sửa được';

  it.each([Role.ADMIN, Role.SUPER_ADMIN])(
    '%s sửa được kể cả khi vị từ của EDITOR nói không',
    (role) => {
      expect(() =>
        assertContentEditAllowed(role, false, MESSAGE),
      ).not.toThrow();
    },
  );

  it('EDITOR sửa được khi vị từ của module cho phép', () => {
    expect(() =>
      assertContentEditAllowed(Role.EDITOR, true, MESSAGE),
    ).not.toThrow();
  });

  it('EDITOR bị chặn 403 khi vị từ của module không cho phép', () => {
    expect(() => assertContentEditAllowed(Role.EDITOR, false, MESSAGE)).toThrow(
      ForbiddenException,
    );
  });

  it('thông điệp từ chối của module được giữ nguyên văn (Admin CMS hiện thẳng)', () => {
    expect(() => assertContentEditAllowed(Role.EDITOR, false, MESSAGE)).toThrow(
      MESSAGE,
    );
  });

  it('vai trò thiếu → chặn, kể cả ở trạng thái mà EDITOR được phép', () => {
    expect(() => assertContentEditAllowed(undefined, true, MESSAGE)).toThrow(
      ForbiddenException,
    );
    expect(() => assertContentEditAllowed(null, true, MESSAGE)).toThrow(
      ForbiddenException,
    );
  });

  /**
   * So khớp chuỗi vai trò phải ĐÚNG TUYỆT ĐỐI — cùng tính chất đã khoá cho
   * `assertContentStatusTransition`. Một biến thể sai chính tả lọt qua ở đây là
   * mở toang quyền sửa nội dung đang công khai.
   */
  it('biến thể sai chính tả KHÔNG được coi là quản trị → 403', () => {
    for (const role of [
      'super_admin',
      'SUPERADMIN',
      'Admin',
      'admin',
      'editor',
      '',
    ]) {
      expect(() => assertContentEditAllowed(role, false, MESSAGE)).toThrow(
        ForbiddenException,
      );
    }
  });
});

describe('editorMayEditUnpublished (Project / Cooperation / Page)', () => {
  it.each([ContentStatus.DRAFT, ContentStatus.PENDING])(
    '%s: EDITOR còn sửa được',
    (status) => {
      expect(editorMayEditUnpublished(status)).toBe(true);
    },
  );

  it('PUBLISHED: EDITOR không sửa được nữa', () => {
    expect(editorMayEditUnpublished(ContentStatus.PUBLISHED)).toBe(false);
  });
});
