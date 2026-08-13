import { Reflector } from '@nestjs/core';
import { Role } from '../../generated/prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { NewsController } from './news.controller';

/**
 * Chốt quyền của các route tin tức, đọc metadata `@Roles` hiệu dụng đúng theo
 * cơ chế `RolesGuard` dùng (`getAllAndOverride([handler, class])`) — không cần DB.
 *
 * Trọng tâm Batch 3: **đặt lịch là uỷ quyền cho một lần đăng trong tương lai**,
 * nên nó phải chịu đúng lớp chốt của "Đăng ngay" — ADMIN trở lên. Đây chính là
 * lỗ hổng đã vá ở Batch 1 theo hướng ngược lại (khi đó `scheduledAt` đi lẫn
 * trong DTO nội dung mà EDITOR gửi được); mở lại đường ghi ở batch này mà quên
 * chốt quyền là tái lập nguyên vẹn lỗ hổng đó.
 */
describe('NewsController @Roles', () => {
  const reflector = new Reflector();

  function requiredRoles(handlerName: keyof NewsController): Role[] {
    return reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      NewsController.prototype[handlerName],
      NewsController,
    ]);
  }

  it('Lệnh lịch đăng: chỉ ADMIN, SUPER_ADMIN — EDITOR bị chặn', () => {
    for (const handler of [
      'schedulePublication',
      'cancelScheduledPublication',
    ] as const) {
      const roles = requiredRoles(handler);
      expect(roles).toEqual([Role.ADMIN, Role.SUPER_ADMIN]);
      expect(roles).not.toContain(Role.EDITOR);
    }
  });

  it('Lệnh lịch chốt quyền NGANG với "Đăng ngay" (xoá/kích hoạt reconciler)', () => {
    // Không được lỏng hơn các thao tác có cùng hệ quả công khai.
    expect(requiredRoles('schedulePublication')).toEqual(
      requiredRoles('publishScheduled'),
    );
    expect(requiredRoles('cancelScheduledPublication')).toEqual(
      requiredRoles('remove'),
    );
  });

  it('Sửa nội dung vẫn mở cho EDITOR — batch này không siết luồng biên tập', () => {
    for (const handler of ['create', 'update', 'updateStatus'] as const) {
      expect(requiredRoles(handler)).toContain(Role.EDITOR);
    }
  });

  it('Route công khai không gắn @Roles', () => {
    for (const handler of [
      'findAll',
      'findOne',
      'findAllCategories',
    ] as const) {
      expect(requiredRoles(handler)).toBeUndefined();
    }
  });
});
