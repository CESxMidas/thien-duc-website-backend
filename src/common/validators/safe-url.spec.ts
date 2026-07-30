import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateBannerDto } from '../../banners/dto/create-banner.dto';
import { CreateNewsPostDto } from '../../news/dto/create-news-post.dto';
import { CreateProjectDto } from '../../projects/dto/create-project.dto';
import { isSafeImageRef, isSafeInternalPath } from './safe-url';

/**
 * AUDIT-M2 — hàng rào phía SERVER cho field chứa URL.
 *
 * Trước bản sửa, `href`/`image` chỉ có `@IsString() @MaxLength()`, nên API nhận
 * mọi thứ: `javascript:`, `data:text/html`, `vbscript:`, `//evil.example.com`
 * (đã đo: cả 9 biến thể đều trả 201). React 19 tình cờ chặn `href="javascript:"`
 * lúc render, nhưng đó là cơ chế client của một thư viện — KHÔNG chặn `data:`,
 * `vbscript:` hay URL ngoài, và không được là lớp bảo vệ duy nhất.
 */

// Ky tu vo hinh dung String.fromCharCode -> file nguon thuan ASCII,
// khong nhung byte dieu khien ma editor/diff se an di.
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const NUL = String.fromCharCode(0);
const NBSP = String.fromCharCode(160);
const ZWSP = String.fromCharCode(8203);
describe('isSafeInternalPath — dùng cho href', () => {
  it.each([
    ['/du-an'],
    ['/gioi-thieu'],
    ['/du-an/khu-do-thi-hung-phu/fancy-tower'],
    ['/images/banners/home/x.jpg'],
    ['/'],
    ['/tin-tuc?page=2'],
    ['/du-an#muc-1'],
  ])('nhận đường dẫn nội bộ hợp lệ: %s', (value) => {
    expect(isSafeInternalPath(value)).toBe(true);
  });

  it.each([
    ['javascript:alert(1)'],
    ['JaVaScRiPt:alert(1)'],
    ['JAVASCRIPT:alert(1)'],
    [`  javascript:alert(1)`],
    [`java${TAB}script:alert(1)`],
    [`java${LF}script:alert(1)`],
    [`java${CR}script:alert(1)`],
    [`java${NUL}script:alert(1)`],
    [`${NBSP}javascript:alert(1)`],
    [`java${ZWSP}script:alert(1)`],
    ['data:text/html,<h1>pwned</h1>'],
    ['data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['vbscript:msgbox(1)'],
    ['//evil.example.com/phish'],
    ['/\\evil.example.com'],
    ['http://evil.example.com/x'],
    ['https://evil.example.com/x'],
    ['du-an'],
    [''],
    ['   '],
    [`${TAB}${LF}`],
  ])('từ chối giá trị nguy hiểm/không hợp lệ: %j', (value) => {
    expect(isSafeInternalPath(value)).toBe(false);
  });

  it('từ chối giá trị không phải chuỗi', () => {
    for (const v of [null, undefined, 1, {}, [], true]) {
      expect(isSafeInternalPath(v)).toBe(false);
    }
  });
});

describe('isSafeImageRef — dùng cho image/url/gallery', () => {
  it.each([
    ['/images/projects/a.jpg'],
    ['https://res.cloudinary.com/demo/image/upload/v1/a.webp'],
    ['https://res.cloudinary.com/demo/a.jpg?w=100'],
  ])('nhận: %s', (value) => {
    expect(isSafeImageRef(value)).toBe(true);
  });

  it.each([
    ['http://res.cloudinary.com/demo/a.jpg'],
    ['data:image/svg+xml,<svg onload=alert(1)>'],
    ['javascript:alert(1)'],
    [`java${TAB}script:alert(1)`],
    ['//res.cloudinary.com/demo/a.jpg'],
    ['https://'],
    ['vbscript:msgbox(1)'],
    ['a.jpg'],
    [''],
  ])('từ chối: %j', (value) => {
    expect(isSafeImageRef(value)).toBe(false);
  });
});

describe('DTO thật áp dụng hàng rào', () => {
  const bannerBase = { title: { vi: 't' } };

  function bannerErrors(patch: Record<string, unknown>): string[] {
    const dto = plainToInstance(CreateBannerDto, {
      ...bannerBase,
      image: '/images/a.jpg',
      href: '/du-an',
      ...patch,
    });
    return validateSync(dto).map((e) => e.property);
  }

  it('banner hợp lệ không báo lỗi href/image', () => {
    expect(bannerErrors({})).not.toContain('href');
    expect(bannerErrors({})).not.toContain('image');
  });

  it.each([
    ['javascript:alert(1)'],
    [`java${TAB}script:alert(1)`],
    ['data:text/html,<h1>x</h1>'],
    ['//evil.example.com'],
    ['https://evil.example.com'],
  ])('banner.href nguy hiểm bị chặn: %j', (href) => {
    expect(bannerErrors({ href })).toContain('href');
  });

  it.each([
    ['javascript:alert(1)'],
    ['data:image/svg+xml,<svg onload=alert(1)>'],
  ])('banner.image nguy hiểm bị chặn: %j', (image) => {
    expect(bannerErrors({ image })).toContain('image');
  });

  it('news.image nguy hiểm bị chặn, hợp lệ thì không', () => {
    const errs = (image: string) =>
      validateSync(
        plainToInstance(CreateNewsPostDto, {
          slug: 'a',
          title: { vi: 't' },
          summary: { vi: 's' },
          image,
        }),
      ).map((e) => e.property);
    expect(errs('javascript:alert(1)')).toContain('image');
    expect(errs('/images/news/a.jpg')).not.toContain('image');
    expect(errs('https://res.cloudinary.com/demo/a.jpg')).not.toContain(
      'image',
    );
  });

  it('project.image + gallery[] nguy hiểm bị chặn', () => {
    const errs = (patch: Record<string, unknown>) =>
      validateSync(
        plainToInstance(CreateProjectDto, {
          slug: 'a',
          title: { vi: 't' },
          summary: { vi: 's' },
          status: 'DA_BAN_GIAO',
          ...patch,
        }),
      ).map((e) => e.property);
    expect(errs({ image: 'javascript:alert(1)' })).toContain('image');
    expect(
      errs({ gallery: ['/images/ok.jpg', 'javascript:alert(1)'] }),
    ).toContain('gallery');
    expect(errs({ gallery: ['/images/ok.jpg'] })).not.toContain('gallery');
  });
});
