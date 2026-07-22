import { Reflector } from '@nestjs/core';
import { Role } from '../../generated/prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { BannersController } from './banners.controller';

/**
 * ADMIN-ROLE-VISIBILITY-AUDIT-M1 / R2: banner là nội dung trang chủ hiển thị cao,
 * không có luồng duyệt — mọi thao tác thay đổi (tạo/sửa/bật-tắt/sắp xếp/xóa) chỉ
 * cho ADMIN/SUPER_ADMIN. Đọc (danh sách/chi tiết cho Admin CMS) giữ nguyên
 * EDITOR trở lên; route công khai `GET /banners` không gắn @Roles.
 *
 * Test đọc metadata @Roles hiệu dụng theo đúng cơ chế `RolesGuard` dùng
 * (`getAllAndOverride([handler, class])`) nên không cần DB.
 */
describe('BannersController @Roles (R2: chặn EDITOR quản lý banner)', () => {
  const reflector = new Reflector();

  function requiredRoles(handlerName: keyof BannersController): Role[] {
    return reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      BannersController.prototype[handlerName],
      BannersController,
    ]);
  }

  it('Thao tác thay đổi banner: chỉ ADMIN, SUPER_ADMIN (không EDITOR)', () => {
    for (const handler of ['create', 'update', 'reorder', 'remove'] as const) {
      const roles = requiredRoles(handler);
      expect(roles).toEqual([Role.ADMIN, Role.SUPER_ADMIN]);
      expect(roles).not.toContain(Role.EDITOR);
    }
  });

  it('Đọc cho Admin CMS: EDITOR trở lên vẫn xem được (không đổi)', () => {
    for (const handler of ['findAllForAdmin', 'findOne'] as const) {
      const roles = requiredRoles(handler);
      expect(roles).toEqual([Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN]);
      expect(roles).toContain(Role.EDITOR);
    }
  });

  it('Route công khai GET /banners: không gắn @Roles', () => {
    expect(requiredRoles('findAll')).toBeUndefined();
  });
});
