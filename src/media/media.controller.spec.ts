import { Reflector } from '@nestjs/core';
import { Role } from '../../generated/prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { MediaController } from './media.controller';

/**
 * ADMIN-ROLE-VISIBILITY-AUDIT-M1 / R1: xóa ảnh là thao tác phá hủy (gỡ khỏi
 * Cloudinary, có thể hỏng trang đang dùng) nên chỉ ADMIN/SUPER_ADMIN được gọi
 * `DELETE /media/:id`. Upload/list/create giữ nguyên cho EDITOR trở lên.
 *
 * `RolesGuard` chốt quyền bằng `reflector.getAllAndOverride(ROLES_KEY, [handler,
 * class])` — @Roles cấp method thắng @Roles cấp controller. Test dùng đúng cơ
 * chế đó để khẳng định quyền hiệu dụng của từng route mà không cần DB.
 */
describe('MediaController @Roles (R1: chặn EDITOR xóa ảnh)', () => {
  const reflector = new Reflector();

  function requiredRoles(handlerName: keyof MediaController): Role[] {
    return reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      MediaController.prototype[handlerName],
      MediaController,
    ]);
  }

  it('DELETE /media/:id: chỉ ADMIN, SUPER_ADMIN (không có EDITOR)', () => {
    const roles = requiredRoles('remove');
    expect(roles).toEqual([Role.ADMIN, Role.SUPER_ADMIN]);
    expect(roles).not.toContain(Role.EDITOR);
  });

  it('Upload/list/create: EDITOR trở lên vẫn dùng được (không đổi)', () => {
    for (const handler of ['upload', 'create', 'findAll', 'findOne'] as const) {
      const roles = requiredRoles(handler);
      expect(roles).toEqual([Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN]);
      expect(roles).toContain(Role.EDITOR);
    }
  });
});
