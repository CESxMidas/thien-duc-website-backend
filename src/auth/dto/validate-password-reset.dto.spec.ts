import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ValidatePasswordResetDto } from './validate-password-reset.dto';

async function validatePayload(payload: Record<string, unknown>) {
  const dto = plainToInstance(ValidatePasswordResetDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

function failedProperties(errors: Awaited<ReturnType<typeof validate>>) {
  return errors.map((error) => error.property);
}

describe('ValidatePasswordResetDto', () => {
  it('token hợp lệ đi qua, không lỗi', async () => {
    const errors = await validatePayload({ token: 'raw-reset-token' });
    expect(errors).toHaveLength(0);
  });

  it('token rỗng bị từ chối', async () => {
    const errors = await validatePayload({ token: '' });
    expect(failedProperties(errors)).toContain('token');
  });

  it('token quá dài (>512) bị từ chối', async () => {
    const errors = await validatePayload({ token: 'a'.repeat(513) });
    expect(failedProperties(errors)).toContain('token');
  });

  it('chặn field lạ', async () => {
    const errors = await validatePayload({
      token: 'raw-reset-token',
      email: 'admin@thienduc.vn',
    });
    expect(failedProperties(errors)).toContain('email');
  });
});
