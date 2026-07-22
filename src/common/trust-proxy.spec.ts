import { configureTrustProxy, TRUSTED_PROXY_HOPS } from './trust-proxy';

/**
 * TRUSTED-PROXY-RATE-LIMIT-FIX-M1 (Finding 7): sau reverse proxy của Render,
 * `req.ip` chỉ đúng IP client khi Express tin đúng số hop proxy. Test kiểm hàm
 * cấu hình để không phải chạy bootstrap thật (giống main.spec.ts kiểm CORS).
 */
describe('configureTrustProxy (Finding 7)', () => {
  it('đặt "trust proxy" = 1 hop (Render có đúng 1 lớp reverse proxy)', () => {
    const set = jest.fn();
    configureTrustProxy({ set });

    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('trust proxy', 1);
    expect(TRUSTED_PROXY_HOPS).toBe(1);
  });

  it('KHÔNG tin mọi proxy (không dùng `true`) để tránh giả X-Forwarded-For', () => {
    const set = jest.fn();
    configureTrustProxy({ set });

    expect(set).not.toHaveBeenCalledWith('trust proxy', true);
  });
});
