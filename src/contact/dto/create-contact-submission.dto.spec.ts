import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateContactSubmissionDto } from './create-contact-submission.dto';

/**
 * Kiểm thử task →3 (finding #9 audit): trần độ dài trên endpoint công khai
 * POST /contact — payload hợp lệ đi qua, payload quá trần bị chặn ở tầng DTO
 * (ValidationPipe global sẽ trả 400 trước khi chạm service/DB).
 */
const validPayload = {
  name: 'Nguyễn Văn A',
  phone: '0900000000',
  email: 'a@example.com',
  inquiryType: 'Báo giá',
  message: 'Xin báo giá dự án Hưng Phú',
};

async function validatePayload(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateContactSubmissionDto, payload);
  return validate(dto);
}

/** Danh sách property có lỗi, để assert đúng field bị chặn. */
function failedProperties(errors: Awaited<ReturnType<typeof validate>>) {
  return errors.map((error) => error.property);
}

describe('CreateContactSubmissionDto (task →3: trần độ dài)', () => {
  it('payload hợp lệ đi qua, không lỗi', async () => {
    const errors = await validatePayload(validPayload);
    expect(errors).toHaveLength(0);
  });

  // `@IsEmail` (validator.js) tự giới hạn local-part ≤ 64 ký tự — email dài
  // phải dồn độ dài vào phần domain (mỗi label ≤ 63) mới hợp lệ về cấu trúc.
  // 64 + "@" + 63 + "." + 63 + "." + 7 = đúng 200 ký tự.
  const emailAt200 = `${'a'.repeat(64)}@${'a'.repeat(63)}.${'b'.repeat(63)}.ccccccc`;
  // Cùng cấu trúc, TLD 8 ký tự → 201 ký tự: vẫn là email hợp lệ về cấu trúc,
  // chỉ vượt trần MaxLength(200).
  const emailAt201 = `${'a'.repeat(64)}@${'a'.repeat(63)}.${'b'.repeat(63)}.cccccccc`;

  it('giá trị đúng bằng trần vẫn đi qua (biên trên hợp lệ)', async () => {
    const errors = await validatePayload({
      name: 'a'.repeat(120),
      phone: '0'.repeat(30),
      email: emailAt200,
      inquiryType: 'b'.repeat(100),
      message: 'c'.repeat(5000),
    });
    expect(errors).toHaveLength(0);
  });

  it.each([
    ['name', { name: 'a'.repeat(121) }],
    ['phone', { phone: '0'.repeat(31) }],
    ['email', { email: emailAt201 }],
    ['inquiryType', { inquiryType: 'b'.repeat(101) }],
    ['message', { message: 'c'.repeat(5001) }],
  ])('chặn %s vượt trần 1 ký tự', async (field, overrides) => {
    const errors = await validatePayload({ ...validPayload, ...overrides });
    expect(failedProperties(errors)).toContain(field);
  });

  it('chặn message khổng lồ (kịch bản DoS ~100KB của finding #9)', async () => {
    const errors = await validatePayload({
      ...validPayload,
      message: 'x'.repeat(100_000),
    });
    expect(failedProperties(errors)).toContain('message');
  });

  it('vẫn giữ các ràng buộc cũ: message rỗng bị chặn (MinLength 1)', async () => {
    const errors = await validatePayload({ ...validPayload, message: '' });
    expect(failedProperties(errors)).toContain('message');
  });
});
