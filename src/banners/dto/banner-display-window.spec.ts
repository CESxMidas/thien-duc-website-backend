import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateBannerDto } from './create-banner.dto';
import { UpdateBannerDto } from './update-banner.dto';

/**
 * BANNER — cửa sổ hiển thị đi qua **ValidationPipe THẬT** với đúng cấu hình ở
 * `src/main.ts`. Chỉ bộ ba option đó mới quyết định điều quan trọng nhất ở đây:
 *
 *  - `whitelist` + `forbidNonWhitelisted`: field lạ thành 400. Đây là lý do phải
 *    kiểm rằng `scheduledAt`/`publishedAt` KHÔNG len được vào payload banner —
 *    banner cố tình không có vòng đời xuất bản.
 *  - Việc `null` tường minh SỐNG SÓT qua pipe (không bị biến thành `undefined`)
 *    là điều kiện cần để xoá được biên cửa sổ. `@IsOptional()` bỏ qua cả `null`
 *    lẫn `undefined`, nhưng giá trị thì phải nguyên vẹn khi ra tới service.
 */

/** Đúng cấu hình pipe toàn cục ở `src/main.ts`. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const bilingual = (vi: string) => ({ vi, en: vi });

const validBanner = {
  image: '/images/banners/home/a.jpg',
  title: bilingual('Khu đô thị Hưng Phú'),
  href: '/du-an',
};

const asCreate = (body: Record<string, unknown>) =>
  pipe.transform(body, { type: 'body', metatype: CreateBannerDto });

const asUpdate = (body: Record<string, unknown>) =>
  pipe.transform(body, { type: 'body', metatype: UpdateBannerDto });

describe('CreateBannerDto — cửa sổ hiển thị', () => {
  it('không gửi hai field: hợp lệ, và không tự sinh giá trị nào', async () => {
    const dto = (await asCreate({ ...validBanner })) as CreateBannerDto;
    expect(dto.displayFrom).toBeUndefined();
    expect(dto.displayUntil).toBeUndefined();
  });

  it.each([
    ['chỉ displayFrom', { displayFrom: '2026-09-01T08:00:00+07:00' }],
    ['chỉ displayUntil', { displayUntil: '2026-09-30T17:00:00.000Z' }],
    [
      'cả hai biên',
      {
        displayFrom: '2026-09-01T08:00:00+07:00',
        displayUntil: '2026-09-30T08:00:00+07:00',
      },
    ],
  ])('%s: đi qua được pipe', async (_label, window) => {
    await expect(
      asCreate({ ...validBanner, ...window }),
    ).resolves.toMatchObject(window);
  });

  describe('bắt buộc instant ISO có múi giờ tường minh', () => {
    it.each([
      ['offset +07:00', '2026-09-01T08:00:00+07:00'],
      ['UTC hậu tố Z', '2026-09-01T01:00:00.000Z'],
      ['Z không có mili giây', '2026-09-01T01:00:00Z'],
      ['offset âm', '2026-09-01T01:00:00-05:00'],
    ])('%s: chấp nhận', async (_label, value) => {
      await expect(
        asCreate({ ...validBanner, displayFrom: value }),
      ).resolves.toBeDefined();
    });

    it.each([
      ['thiếu hẳn múi giờ', '2026-09-01T08:00:00'],
      ['chỉ có ngày', '2026-09-01'],
      ['định dạng SQL, dấu cách thay T', '2026-09-01 08:00:00+07:00'],
      ['ngày không có thật', '2026-02-31T08:00:00+07:00'],
      ['giờ không hợp lệ', '2026-09-01T25:00:00+07:00'],
      ['chuỗi rỗng', ''],
      ['không phải chuỗi', 12345],
    ])('%s: từ chối 400', async (_label, value) => {
      await expect(
        asCreate({ ...validBanner, displayFrom: value }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('displayUntil cũng bị soi bằng đúng luật đó', async () => {
      await expect(
        asCreate({ ...validBanner, displayUntil: '2026-09-01T08:00' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  /**
   * `2026-09-01T08:00:00+07:00` và `2026-09-01T01:00:00.000Z` là CÙNG một
   * instant. Chuỗi khác nhau, giá trị phải bằng nhau — đó mới là thứ có nghĩa.
   */
  it('so sánh theo instant, không theo hình dạng chuỗi', async () => {
    const offset = (await asCreate({
      ...validBanner,
      displayFrom: '2026-09-01T08:00:00+07:00',
    })) as CreateBannerDto;
    const utc = (await asCreate({
      ...validBanner,
      displayFrom: '2026-09-01T01:00:00.000Z',
    })) as CreateBannerDto;

    expect(Date.parse(offset.displayFrom as string)).toBe(
      Date.parse(utc.displayFrom as string),
    );
  });

  it('KHÔNG nhận scheduledAt/publishedAt/status — banner không có vòng đời xuất bản', async () => {
    for (const field of ['scheduledAt', 'publishedAt', 'status']) {
      await expect(
        asCreate({ ...validBanner, [field]: '2026-09-01T01:00:00.000Z' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});

describe('UpdateBannerDto — xoá biên bằng null tường minh', () => {
  it('null sống sót qua pipe, KHÔNG bị biến thành undefined', async () => {
    const dto = (await asUpdate({
      displayFrom: null,
      displayUntil: null,
    })) as UpdateBannerDto;

    expect(dto.displayFrom).toBeNull();
    expect(dto.displayUntil).toBeNull();
    // Phân biệt được "xoá" với "không đụng tới" — service dựa hẳn vào chỗ này.
    expect(dto.displayFrom).not.toBeUndefined();
  });

  it('xoá một biên, đặt biên kia trong cùng một PATCH', async () => {
    const dto = (await asUpdate({
      displayFrom: null,
      displayUntil: '2026-12-31T17:00:00.000Z',
    })) as UpdateBannerDto;

    expect(dto.displayFrom).toBeNull();
    expect(dto.displayUntil).toBe('2026-12-31T17:00:00.000Z');
  });

  it('PATCH rỗng: không có field cửa sổ nào mang giá trị', async () => {
    const dto = (await asUpdate({})) as UpdateBannerDto;
    expect(dto.displayFrom ?? undefined).toBeUndefined();
    expect(dto.displayUntil ?? undefined).toBeUndefined();
  });

  it('vẫn từ chối chuỗi thiếu múi giờ ở luồng sửa', async () => {
    await expect(
      asUpdate({ displayFrom: '2026-09-01T08:00' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
