import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Cầu chì cứng cho mọi route hỗ trợ test. Ba điều kiện phải cùng đúng, nếu không
 * thì ném 404 (ẩn hoàn toàn sự tồn tại của route — không tiết lộ 403):
 *
 *   1. NODE_ENV === 'test'
 *   2. MAIL_FAKE_TRANSPORT === '1' (cờ bật tường minh)
 *   3. request đến từ localhost (127.0.0.1 / ::1)
 *
 * Đây là lớp phòng thủ THỨ HAI: TestSupportModule vốn chỉ được nạp khi (1)+(2)
 * đúng, nên ở production route này không tồn tại. Guard vẫn kiểm tra lại để
 * không phụ thuộc mỗi việc nạp module, và chặn thêm truy cập không phải localhost.
 */
@Injectable()
export class TestOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const envOk =
      process.env.NODE_ENV === 'test' &&
      process.env.MAIL_FAKE_TRANSPORT === '1';
    if (!envOk) {
      throw new NotFoundException();
    }

    const req = context.switchToHttp().getRequest<Request>();
    if (!TestOnlyGuard.isLocalhost(req.ip)) {
      throw new NotFoundException();
    }
    return true;
  }

  /** localhost gồm IPv4, IPv6 loopback và dạng IPv4-mapped-IPv6 của Node. */
  static isLocalhost(ip: string | undefined): boolean {
    if (!ip) return false;
    return (
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip === '::ffff:127.0.0.1' ||
      ip === 'localhost'
    );
  }
}
