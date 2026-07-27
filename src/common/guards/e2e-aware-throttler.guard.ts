import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * ThrottlerGuard nhưng BỎ QUA rate-limit khi (và chỉ khi) đang chạy trong bộ
 * E2E cục bộ: NODE_ENV=test VÀ MAIL_FAKE_TRANSPORT=1 — đúng cặp cờ đã gate
 * transport email giả và module test-support. Bộ E2E kiểm luồng chức năng, không
 * kiểm rate-limit, nên nếu giữ giới hạn 5 lần/phút thì các bước đăng nhập / quên
 * mật khẩu lặp lại sẽ bị 429.
 *
 * Ở PRODUCTION cờ này KHÔNG BAO GIỜ được đặt → `super.canActivate` chạy đầy đủ,
 * hành vi rate-limit giữ nguyên. Đây là afferdance riêng cho test, không đổi
 * hành vi nghiệp vụ production.
 */
@Injectable()
export class E2eAwareThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      process.env.NODE_ENV === 'test' &&
      process.env.MAIL_FAKE_TRANSPORT === '1'
    ) {
      return true;
    }
    return super.canActivate(context);
  }
}
