import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AcceptInvitationDto } from './accept-invitation.dto';

/**
 * CMS-ACCOUNT-INVITATION-PHASE2A: DTO này không có `email`/`role`/`userId`/
 * `isActive`/`setupCompletedAt`/field hồ sơ nào — chính vì thế người được mời
 * không thể tự đổi vai trò/email lúc thiết lập (kiểm bằng forbidNonWhitelisted,
 * khớp ValidationPipe toàn cục ở main.ts).
 */
const validPayload = {
  token: 'raw-invitation-token',
  newPassword: 'MatKhauMoi123',
  confirmPassword: 'MatKhauMoi123',
};

async function validatePayload(payload: Record<string, unknown>) {
  const dto = plainToInstance(AcceptInvitationDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

function failedProperties(errors: Awaited<ReturnType<typeof validate>>) {
  return errors.map((error) => error.property);
}

describe('AcceptInvitationDto', () => {
  it('payload hợp lệ đi qua, không lỗi', async () => {
    const errors = await validatePayload(validPayload);
    expect(errors).toHaveLength(0);
  });

  it.each([
    ['email', { email: 'chiem@thienduc.vn' }],
    ['role', { role: 'SUPER_ADMIN' }],
    ['userId', { userId: 'khac' }],
    ['isActive', { isActive: false }],
    ['setupCompletedAt', { setupCompletedAt: new Date().toISOString() }],
    ['name', { name: 'Tên khác' }],
  ])('chặn field lạ/không cho phép đổi "%s"', async (field, overrides) => {
    const errors = await validatePayload({ ...validPayload, ...overrides });
    expect(failedProperties(errors)).toContain(field);
  });

  it('mật khẩu tối thiểu 8 ký tự, giống chính sách hiện có', async () => {
    const errors = await validatePayload({
      ...validPayload,
      newPassword: '1234567',
      confirmPassword: '1234567',
    });
    expect(failedProperties(errors)).toContain('newPassword');
  });

  it('mật khẩu tối đa 128 ký tự', async () => {
    const tooLong = 'a'.repeat(129);
    const errors = await validatePayload({
      ...validPayload,
      newPassword: tooLong,
      confirmPassword: tooLong,
    });
    expect(failedProperties(errors)).toContain('newPassword');
  });

  it('token không được rỗng', async () => {
    const errors = await validatePayload({ ...validPayload, token: '' });
    expect(failedProperties(errors)).toContain('token');
  });
});
