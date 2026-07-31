import { RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../generated/prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { UsersController } from './users.controller';

/**
 * ADMIN-ROLE-VISIBILITY-AUDIT-M1 / R3 (lock-in): quyền quản lý tài khoản.
 * - Đọc danh sách/chi tiết: ADMIN + SUPER_ADMIN (ADMIN xem read-only).
 * - Tạo/sửa/khóa/đổi vai trò: chỉ SUPER_ADMIN (ADMIN không nằm trong danh sách).
 * - EDITOR không đụng được vào bất kỳ route *quản lý tài khoản* nào.
 *
 * Lưu ý: các route **hồ sơ cá nhân** (`/users/me`, `updateMyProfile`) là tính năng
 * self-service riêng, cố ý mở cho EDITOR trở lên — không thuộc phạm vi "quản lý
 * tài khoản" nên được kiểm riêng bên dưới để bản đặc tả trung thực.
 *
 * Đọc metadata @Roles đúng theo cơ chế `RolesGuard` (`getAllAndOverride([handler,
 * class])`) nên không cần DB.
 */
describe('UsersController @Roles (R3: ADMIN read-only, SUPER_ADMIN quản lý)', () => {
  const reflector = new Reflector();

  function requiredRoles(handlerName: keyof UsersController): Role[] {
    return reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      UsersController.prototype[handlerName],
      UsersController,
    ]);
  }

  it('Đọc danh sách/chi tiết: ADMIN + SUPER_ADMIN, không EDITOR', () => {
    for (const handler of ['findAll', 'findOne'] as const) {
      const roles = requiredRoles(handler);
      expect(roles).toEqual([Role.ADMIN, Role.SUPER_ADMIN]);
      expect(roles).not.toContain(Role.EDITOR);
    }
  });

  it('Sửa/xóa (khóa)/đổi vai trò: chỉ SUPER_ADMIN', () => {
    for (const handler of ['update', 'remove'] as const) {
      const roles = requiredRoles(handler);
      expect(roles).toEqual([Role.SUPER_ADMIN]);
      expect(roles).not.toContain(Role.ADMIN);
      expect(roles).not.toContain(Role.EDITOR);
    }
  });

  // CMS-ACCOUNT-INVITATION-PHASE2A: tạo/gửi lại/thu hồi lời mời cũng chỉ
  // SUPER_ADMIN — cùng mức quyền với tạo/sửa/xóa tài khoản trực tiếp.
  it('Lời mời tài khoản (tạo/gửi lại/thu hồi): chỉ SUPER_ADMIN', () => {
    for (const handler of [
      'createInvitation',
      'resendInvitation',
      'revokeInvitation',
    ] as const) {
      const roles = requiredRoles(handler);
      expect(roles).toEqual([Role.SUPER_ADMIN]);
      expect(roles).not.toContain(Role.ADMIN);
      expect(roles).not.toContain(Role.EDITOR);
    }
  });

  it('EDITOR không nằm trong bất kỳ route quản lý tài khoản nào', () => {
    for (const handler of [
      'findAll',
      'findOne',
      'update',
      'remove',
      'createInvitation',
      'resendInvitation',
      'revokeInvitation',
    ] as const) {
      expect(requiredRoles(handler)).not.toContain(Role.EDITOR);
    }
  });

  // CMS-RETIRE-DIRECT-USER-CREATE-M1: route tạo trực tiếp kèm mật khẩu đã gỡ.
  it('KHÔNG còn handler `create` — cấp tài khoản chỉ qua lời mời', () => {
    expect(
      (UsersController.prototype as unknown as Record<string, unknown>).create,
    ).toBeUndefined();
    const handlers = Object.getOwnPropertyNames(UsersController.prototype);
    expect(handlers).not.toContain('create');
    expect(handlers).toContain('createInvitation');
  });

  it('KHÔNG còn route POST "/users" gốc — mọi POST đều có path con', () => {
    const postPaths = Object.getOwnPropertyNames(UsersController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => {
        const handler =
          UsersController.prototype[name as keyof UsersController];
        return {
          path: reflector.get<string>('path', handler),
          method: reflector.get<RequestMethod>('method', handler),
        };
      })
      .filter((route) => route.method === RequestMethod.POST)
      .map((route) => route.path);

    expect(postPaths).toContain('invitations');
    // `@Post()` không tham số được Nest lưu path '/' — không còn cái nào.
    expect(postPaths).not.toContain('/');
  });

  it('Hồ sơ cá nhân self-service vẫn mở cho EDITOR trở lên (ngoài phạm vi)', () => {
    for (const handler of ['getMyProfile', 'updateMyProfile'] as const) {
      expect(requiredRoles(handler)).toEqual([
        Role.EDITOR,
        Role.ADMIN,
        Role.SUPER_ADMIN,
      ]);
    }
  });
});
