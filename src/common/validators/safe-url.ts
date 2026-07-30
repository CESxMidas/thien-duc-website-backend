import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Kiem tra an toan cho cac field CHUA URL do nguoi dung CMS nhap (`href`,
 * `image`, `url`, `gallery[]`).
 *
 * **Cach tiep can: ALLOWLIST theo HINH DANG, khong phai denylist theo scheme.**
 * Denylist (`javascript:`, `data:`, `vbscript:`...) luon thua vi co vo so bien
 * the lam roi: chu HOA/thuong lan lon, khoang trang dau, va **tab/newline chen
 * giua ten scheme** - trinh duyet tu bo cac ky tu dieu khien do nen
 * `java<TAB>script:alert(1)` van chay. O day ta chi nhan dung hai hinh dang hop
 * le ma san pham that dang dung, nen moi bien the tren deu truot ngay tu dau:
 *
 *   1. Duong dan noi bo:  `/du-an`, `/gioi-thieu`, `/images/banners/x.jpg`
 *   2. (chi cho anh) URL tuyet doi **https**: `https://res.cloudinary.com/...`
 *
 * Du lieu that da kiem trong DB deu la duong dan noi bo; anh upload qua
 * Cloudinary tra ve URL `https://res.cloudinary.com/...` (da khai o
 * `frontend/next.config.ts` `images.remotePatterns`) nen nhanh https la can
 * thiet cho anh, KHONG can cho `href`.
 *
 * Day la hang rao **phia server**. React 19 tuy co chan `href="javascript:"`
 * luc render, nhung do la co che cua mot thu vien client - khong duoc coi la
 * lop bao mat duy nhat, va no KHONG chan `data:`, `vbscript:` hay
 * `//evil.example.com`.
 */

/**
 * Ky tu dieu khien + moi loai khoang trang Unicode, bi bo truoc khi soi hinh
 * dang. Viet bang escape (khong nhung ky tu thô) de file nguon khong chua byte
 * dieu khien.
 */
// CO Y khop ky tu dieu khien: trinh duyet bo chung khi phan giai scheme,
// nen bien the chen tab/newline giua ten scheme van chay duoc. Muon chan
// duoc chung thi bat buoc phai nhan dien chung o day.
const STRIPPABLE = new RegExp(
  // eslint-disable-next-line no-control-regex
  '[\u0000-\u0020\u007f-\u00a0\u1680\u2000-\u200f\u2028\u2029\u202f\u205f\u3000\ufeff]',
  'g',
);

/**
 * Bo moi ky tu ma trinh duyet se bo qua khi phan giai scheme. Nho vay
 * `java\tscript:`, ` javascript:`, `java\nscript:` deu quy ve `javascript:` -
 * khong the lach bang cach chen ky tu vo hinh.
 */
function collapse(value: string): string {
  return value.replace(STRIPPABLE, '');
}

/**
 * Duong dan noi bo an toan: bat dau bang dung MOT dau `/`.
 *
 * Chan `//evil.example.com` (protocol-relative -> thanh URL ngoai) va
 * `/\evil.com` (trinh duyet coi `/\` tuong duong `//`). Cung chan luon moi thu
 * co scheme vi chung khong bat dau bang `/`.
 */
export function isSafeInternalPath(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = collapse(value);
  if (v.length === 0) return false;
  if (v[0] !== '/') return false;
  if (v[1] === '/' || v[1] === '\\') return false;
  return true;
}

/**
 * Tham chieu anh an toan: duong dan noi bo HOAC URL tuyet doi `https:`.
 * `http:` bi tu choi (mixed-content tren site https), `data:`/`javascript:`
 * cung vay vi khong khop hinh dang nao.
 */
export function isSafeImageRef(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (isSafeInternalPath(value)) return true;
  const v = collapse(value);
  if (!/^https:\/\//i.test(v)) return false;
  try {
    const url = new URL(v);
    return url.protocol === 'https:' && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** `href` phai la duong dan noi bo (site tu dieu huong, khong mo scheme la). */
export function IsSafeInternalPath(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isSafeInternalPath',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => isSafeInternalPath(value),
        defaultMessage: () =>
          `${propertyName} phai la duong dan noi bo bat dau bang "/" (khong nhan scheme nhu javascript:, data:, hay "//host" ben ngoai)`,
      },
    });
  };
}

/** `image`/`url` cho phep duong dan noi bo hoac URL https tuyet doi. */
export function IsSafeImageRef(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isSafeImageRef',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => isSafeImageRef(value),
        defaultMessage: () =>
          `${propertyName} phai la duong dan noi bo bat dau bang "/" hoac URL https:// hop le`,
      },
    });
  };
}
