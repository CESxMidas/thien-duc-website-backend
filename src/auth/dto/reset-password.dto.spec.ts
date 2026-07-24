import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResetPasswordDto } from './reset-password.dto';

/**
 * DTO không có `email`/`role`/`userId`/`isActive`/`setupCompletedAt`/
 * `passwordHash`/`tokenHash` — chính chủ chỉ đổi được mật khẩu. Khớp
 * ValidationPipe toàn cục (`whitelist + forbidNonWhitelisted`) ở main.ts.
 */
const validPayload = {
  token: 'raw-reset-token',
  newPassword: 'MatKhauMoi123',
  confirmPassword: 'MatKhauMoi123',
};

async function validatePayload(payload: Record<string, unknown>) {
  const dto = plainToInstance(ResetPasswordDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

function failedProperties(errors: Awaited<ReturnType<typeof validate>>) {
  return errors.map((error) => error.property);
}

describe('ResetPasswordDto', () => {
  it('payload hợp lệ đi qua, không lỗi', async () => {
    const errors = await validatePayload(validPayload);
    expect(errors).toHaveLength(0);
  });

  it.each([['token'], ['newPassword'], ['confirmPassword']])(
    'yêu cầu bắt buộc field "%s"',
    async (field) => {
      const payload: Record<string, unknown> = { ...validPayload };
      delete payload[field];
      const errors = await validatePayload(payload);
      expect(failedProperties(errors)).toContain(field);
    },
  );

  it('token rỗng bị từ chối', async () => {
    const errors = await validatePayload({ ...validPayload, token: '' });
    expect(failedProperties(errors)).toContain('token');
  });

  it('mật khẩu tối thiểu 8 ký tự (khớp chính sách hiện có)', async () => {
    const errors = await validatePayload({
      ...validPayload,
      newPassword: '1234567',
      confirmPassword: '1234567',
    });
    expect(failedProperties(errors)).toContain('newPassword');
  });

  it('mật khẩu tối đa 128 ký tự (khớp luồng lời mời)', async () => {
    const tooLong = 'a'.repeat(129);
    const errors = await validatePayload({
      ...validPayload,
      newPassword: tooLong,
      confirmPassword: tooLong,
    });
    expect(failedProperties(errors)).toContain('newPassword');
  });

  it.each([
    ['email', { email: 'admin@thienduc.vn' }],
    ['role', { role: 'SUPER_ADMIN' }],
    ['userId', { userId: 'khac' }],
    ['isActive', { isActive: false }],
    ['setupCompletedAt', { setupCompletedAt: new Date().toISOString() }],
    ['passwordHash', { passwordHash: 'hash' }],
    ['tokenHash', { tokenHash: 'hash' }],
  ])('chặn field lạ/không cho phép đổi "%s"', async (field, overrides) => {
    const errors = await validatePayload({ ...validPayload, ...overrides });
    expect(failedProperties(errors)).toContain(field);
  });
});
