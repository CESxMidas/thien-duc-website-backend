import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAccountInvitationDto } from './create-account-invitation.dto';

/**
 * CMS-ACCOUNT-INVITATION-PHASE2A: DTO này KHÔNG có field mật khẩu — kiểm tra
 * bằng chính cơ chế ValidationPipe toàn cục (`whitelist + forbidNonWhitelisted`,
 * xem main.ts) để đảm bảo gửi kèm `password` hay bất kỳ field nội bộ nào của
 * User đều bị chặn ngay ở tầng DTO, không chạm tới service/DB.
 */
const validPayload = {
  email: 'moi@thienduc.vn',
  name: 'Người được mời',
  role: 'EDITOR',
};

async function validatePayload(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateAccountInvitationDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

function failedProperties(errors: Awaited<ReturnType<typeof validate>>) {
  return errors.map((error) => error.property);
}

describe('CreateAccountInvitationDto', () => {
  it('payload hợp lệ đi qua, không lỗi', async () => {
    const errors = await validatePayload(validPayload);
    expect(errors).toHaveLength(0);
  });

  it.each([
    ['password', { password: 'MatKhauLau123' }],
    ['setupCompletedAt', { setupCompletedAt: new Date().toISOString() }],
    ['isActive', { isActive: true }],
    ['passwordHash', { passwordHash: 'gia-mao' }],
    ['failedLoginAttempts', { failedLoginAttempts: 0 }],
    ['lockedUntil', { lockedUntil: null }],
    ['token', { token: 'gia-mao-token' }],
    ['tokenHash', { tokenHash: 'gia-mao-hash' }],
  ])(
    'chặn field lạ/nội bộ "%s" — forbidNonWhitelisted trả lỗi',
    async (field, overrides) => {
      const errors = await validatePayload({ ...validPayload, ...overrides });
      expect(failedProperties(errors)).toContain(field);
    },
  );

  it('bắt buộc email đúng định dạng', async () => {
    const errors = await validatePayload({ ...validPayload, email: 'sai' });
    expect(failedProperties(errors)).toContain('email');
  });

  it('bắt buộc role thuộc enum Role', async () => {
    const errors = await validatePayload({
      ...validPayload,
      role: 'KHONG_TON_TAI',
    });
    expect(failedProperties(errors)).toContain('role');
  });
});
