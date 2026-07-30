import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Chuoi BAT BUOC khong duoc chi gom khoang trang.
 *
 * Truoc ban sua nay, `title: { vi: '   ' }` va `title: { vi: '' }` deu tra 201:
 * `TranslatedTextDto.vi` chi co `@IsString()` + `@MaxLength()`. Ket qua la tao
 * duoc bai viet/du an co tieu de trang, render ra trang cong khai thanh mot
 * khoang trong (defect D5 cua AUDIT-M1).
 *
 * HOP DONG: **TU CHOI, KHONG TU DONG TRIM.**
 * - Khong bao gio am tham sua du lieu nguoi dung gui len; bao loi ro rang de
 *   bien tap vien tu sua.
 * - Vi khong trim, `@MaxLength` van do tren chuoi THO. Nghia la '  ' + 5000 ky
 *   tu = 5002 > 5000 -> bi chan boi MaxLength (khong phai boi rule nay).
 * - Khoang trang dau/cuoi quanh noi dung THAT van duoc chap nhan:
 *   '  Tieu de that  ' hop le.
 *
 * Pham vi: chi ap cho field BAT BUOC. `en?` (ban dich khong bat buoc) va cac
 * field optional khac KHONG bi rang buoc - gui '' cho `en` la cach hop le de noi
 * 'chua co ban dich'.
 */

/**
 * Ky tu coi la 'trang'. `\s` cua JS da phu khoang trang Unicode (NBSP, U+2000-
 * 200A, U+2028/9, U+202F, U+205F, U+3000, FEFF) nhung KHONG phu zero-width
 * (U+200B-200D) - vi the them tay: mot tieu de chi gom zero-width cung la rac.
 */
const ZERO_WIDTH = new RegExp(
  '[' + String.fromCharCode(0x200b, 0x200c, 0x200d) + ']',
  'g',
);

/** True neu chuoi co it nhat mot ky tu co nghia (khong phai khoang trang). */
export function isNotBlank(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value.replace(ZERO_WIDTH, '').trim().length > 0;
}

/** Field bat buoc: tu choi chuoi rong / chi gom khoang trang. Khong trim gia tri. */
export function IsNotBlank(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotBlank',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => isNotBlank(value),
        defaultMessage: () =>
          `${propertyName} khong duoc de trong hoac chi gom khoang trang`,
      },
    });
  };
}
