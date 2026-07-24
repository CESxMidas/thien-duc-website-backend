import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ForgotPasswordRequestDto } from './forgot-password-request.dto';

async function validatePayload(payload: Record<string, unknown>) {
  const dto = plainToInstance(ForgotPasswordRequestDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

function failedProperties(errors: Awaited<ReturnType<typeof validate>>) {
  return errors.map((error) => error.property);
}

describe('ForgotPasswordRequestDto', () => {
  it('email hợp lệ đi qua, không lỗi', async () => {
    const errors = await validatePayload({ email: 'admin@thienduc.vn' });
    expect(errors).toHaveLength(0);
  });

  it('email sai định dạng bị từ chối', async () => {
    const errors = await validatePayload({ email: 'khong-phai-email' });
    expect(failedProperties(errors)).toContain('email');
  });

  it('thiếu email bị từ chối', async () => {
    const errors = await validatePayload({});
    expect(failedProperties(errors)).toContain('email');
  });

  it('email quá dài (>254) bị từ chối', async () => {
    const local = 'a'.repeat(250);
    const errors = await validatePayload({ email: `${local}@thienduc.vn` });
    expect(failedProperties(errors)).toContain('email');
  });

  it('chặn field lạ (không phải kênh dò/đổi thuộc tính tài khoản)', async () => {
    const errors = await validatePayload({
      email: 'admin@thienduc.vn',
      role: 'SUPER_ADMIN',
    });
    expect(failedProperties(errors)).toContain('role');
  });
});
