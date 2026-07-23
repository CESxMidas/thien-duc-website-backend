import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from './update-user.dto';

/**
 * CMS-ACCOUNT-INVITATION-PHASE3C: PATCH /users/:id KHÔNG còn nhận `password`.
 * Kiểm tra bằng chính cơ chế ValidationPipe toàn cục (`whitelist +
 * forbidNonWhitelisted`, xem main.ts): SUPER_ADMIN gửi kèm `password` bị chặn
 * ngay ở tầng DTO, không chạm tới service/DB.
 */
async function validatePayload(payload: Record<string, unknown>) {
  const dto = plainToInstance(UpdateUserDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

function failedProperties(errors: Awaited<ReturnType<typeof validate>>) {
  return errors.map((error) => error.property);
}

describe('UpdateUserDto', () => {
  it('cập nhật tên / email / vai trò / trạng thái vẫn hợp lệ', async () => {
    const errors = await validatePayload({
      name: 'Tên mới',
      email: 'moi@thienduc.vn',
      role: 'ADMIN',
      isActive: false,
    });
    expect(errors).toHaveLength(0);
  });

  it('payload rỗng hợp lệ (mọi field đều tùy chọn)', async () => {
    expect(await validatePayload({})).toHaveLength(0);
  });

  it.each([
    ['password', { password: 'MatKhauMoi123' }],
    ['passwordHash', { passwordHash: 'gia-mao' }],
    ['setupCompletedAt', { setupCompletedAt: new Date().toISOString() }],
    ['failedLoginAttempts', { failedLoginAttempts: 0 }],
    ['lockedUntil', { lockedUntil: null }],
  ])(
    'chặn field lạ/nội bộ "%s" — forbidNonWhitelisted trả lỗi',
    async (field, overrides) => {
      const errors = await validatePayload({ name: 'Tên mới', ...overrides });
      expect(failedProperties(errors)).toContain(field);
    },
  );

  it('email sai định dạng bị chặn', async () => {
    const errors = await validatePayload({ email: 'sai' });
    expect(failedProperties(errors)).toContain('email');
  });

  it('role ngoài enum bị chặn', async () => {
    const errors = await validatePayload({ role: 'KHONG_TON_TAI' });
    expect(failedProperties(errors)).toContain('role');
  });
});
