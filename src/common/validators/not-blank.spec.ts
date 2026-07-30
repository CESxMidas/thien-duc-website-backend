import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateContactSubmissionDto } from '../../contact/dto/create-contact-submission.dto';
import { CreateNewsPostDto } from '../../news/dto/create-news-post.dto';
import { UpdateNewsPostDto } from '../../news/dto/update-news-post.dto';
import { CreatePageDto } from '../../pages/dto/create-page.dto';
import { CreateProjectDto } from '../../projects/dto/create-project.dto';
import { MAX_CONTENT_BLOCKS } from '../dto/content-blocks';
import { isNotBlank } from './not-blank';

/**
 * AUDIT-M2 — D5 (chuoi bat buoc chi gom khoang trang) + D6 (tran so doan).
 *
 * Hop dong D5: **TU CHOI, KHONG TU DONG TRIM** — xem `validators/not-blank.ts`.
 */

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const NBSP = String.fromCharCode(0x00a0);
const IDEO_SPACE = String.fromCharCode(0x3000);
const ZWSP = String.fromCharCode(0x200b);
const EN_SPACE = String.fromCharCode(0x2002);

describe('isNotBlank', () => {
  it.each([
    ['Tieu de that'],
    ['  co khoang trang dau/cuoi  '],
    ['x'],
    ['0'],
    [NBSP + 'chu that' + NBSP],
  ])('nhan chuoi co noi dung: %j', (v) => {
    expect(isNotBlank(v)).toBe(true);
  });

  it.each([
    [''],
    [' '],
    ['   '],
    [TAB],
    [LF],
    [CR],
    [TAB + LF + CR + ' '],
    [NBSP],
    [IDEO_SPACE],
    [EN_SPACE],
    [ZWSP],
    [ZWSP + ZWSP + ' '],
  ])('tu choi chuoi trang: %j', (v) => {
    expect(isNotBlank(v)).toBe(false);
  });

  it('tu choi gia tri khong phai chuoi', () => {
    for (const v of [null, undefined, 0, {}, [], false]) {
      expect(isNotBlank(v)).toBe(false);
    }
  });
});

/** Loi validate cho field long nhau `title.vi` xuat hien duoi property `title`. */
function props(
  dto: new () => object,
  payload: Record<string, unknown>,
): string[] {
  return validateSync(plainToInstance(dto, payload)).map((e) => e.property);
}

describe('D5 — field bat buoc tu choi chuoi chi gom khoang trang', () => {
  const newsBase = { slug: 'a', title: { vi: 't' }, summary: { vi: 's' } };

  it.each([[''], [' '], ['   '], [TAB], [LF], [NBSP], [IDEO_SPACE]])(
    'news title.vi = %j bi chan',
    (vi) => {
      expect(
        props(CreateNewsPostDto, { ...newsBase, title: { vi } }),
      ).toContain('title');
    },
  );

  it('news summary.vi trang bi chan', () => {
    expect(
      props(CreateNewsPostDto, { ...newsBase, summary: { vi: '  ' } }),
    ).toContain('summary');
  });

  it.each([[''], ['  '], [TAB + LF]])('news slug = %j bi chan', (slug) => {
    expect(props(CreateNewsPostDto, { ...newsBase, slug })).toContain('slug');
  });

  it('project title/summary trang bi chan', () => {
    const base = {
      slug: 'a',
      title: { vi: 't' },
      summary: { vi: 's' },
      status: 'DA_BAN_GIAO',
    };
    expect(props(CreateProjectDto, { ...base, title: { vi: ' ' } })).toContain(
      'title',
    );
    expect(
      props(CreateProjectDto, { ...base, summary: { vi: ' ' } }),
    ).toContain('summary');
  });

  it('page title + doan content trang bi chan', () => {
    const base = { slug: 'a', title: { vi: 't' }, content: [{ vi: 'c' }] };
    expect(props(CreatePageDto, { ...base, title: { vi: '  ' } })).toContain(
      'title',
    );
    expect(
      props(CreatePageDto, { ...base, content: [{ vi: '   ' }] }),
    ).toContain('content');
  });

  it('contact name/phone/message trang bi chan', () => {
    const base = { name: 'A', phone: '0900000000', message: 'xin chao' };
    expect(
      props(CreateContactSubmissionDto, { ...base, name: '  ' }),
    ).toContain('name');
    expect(
      props(CreateContactSubmissionDto, { ...base, phone: TAB }),
    ).toContain('phone');
    expect(
      props(CreateContactSubmissionDto, { ...base, message: LF }),
    ).toContain('message');
  });

  it('gia tri hop le KHONG bi chan (khong chan nham)', () => {
    expect(props(CreateNewsPostDto, newsBase)).toHaveLength(0);
    expect(
      props(CreateNewsPostDto, {
        ...newsBase,
        title: { vi: '  Tieu de that  ' },
      }),
    ).toHaveLength(0);
  });

  it('`en` KHONG bat buoc: chuoi rong/trang van hop le', () => {
    expect(
      props(CreateNewsPostDto, { ...newsBase, title: { vi: 't', en: '' } }),
    ).toHaveLength(0);
    expect(
      props(CreateNewsPostDto, { ...newsBase, title: { vi: 't', en: '   ' } }),
    ).toHaveLength(0);
  });

  it('KHONG trim: bien do dai van tinh tren chuoi tho', () => {
    // 5000 la tran cua TranslatedTextDto -> dung tran thi hop le.
    const atLimit = 'a'.repeat(5000);
    expect(
      props(CreateNewsPostDto, { ...newsBase, title: { vi: atLimit } }),
    ).toHaveLength(0);
    // Them 2 khoang trang dau -> 5002 ky tu THO -> MaxLength chan.
    expect(
      props(CreateNewsPostDto, { ...newsBase, title: { vi: '  ' + atLimit } }),
    ).toContain('title');
  });

  it('DTO Update van ap rule khi CO gui field', () => {
    expect(props(UpdateNewsPostDto, { title: { vi: '   ' } })).toContain(
      'title',
    );
    expect(props(UpdateNewsPostDto, {})).toHaveLength(0);
  });
});

describe('D6 — tran so doan content[]', () => {
  const block = { vi: 'doan' };
  const newsWith = (n: number) => ({
    slug: 'a',
    title: { vi: 't' },
    summary: { vi: 's' },
    content: Array.from({ length: n }, () => ({ ...block })),
  });

  it('tran duoc dat o 500 (~10x bai dai nhat that: 48 doan)', () => {
    expect(MAX_CONTENT_BLOCKS).toBe(500);
  });

  it('1 doan hop le', () => {
    expect(props(CreateNewsPostDto, newsWith(1))).toHaveLength(0);
  });

  it('dung tran (500) hop le', () => {
    expect(props(CreateNewsPostDto, newsWith(MAX_CONTENT_BLOCKS))).toHaveLength(
      0,
    );
  });

  it('tran + 1 (501) bi chan', () => {
    expect(
      props(CreateNewsPostDto, newsWith(MAX_CONTENT_BLOCKS + 1)),
    ).toContain('content');
  });

  it('mang rat lon (5000 doan — defect goc) bi chan', () => {
    expect(props(CreateNewsPostDto, newsWith(5000))).toContain('content');
  });

  it('news content[] rong van hop le (field optional)', () => {
    expect(
      props(CreateNewsPostDto, { ...newsWith(1), content: [] }),
    ).toHaveLength(0);
  });

  it('page: content[] rong bi chan (ArrayNotEmpty), dung tran hop le', () => {
    const base = { slug: 'a', title: { vi: 't' } };
    expect(props(CreatePageDto, { ...base, content: [] })).toContain('content');
    expect(
      props(CreatePageDto, {
        ...base,
        content: Array.from({ length: MAX_CONTENT_BLOCKS }, () => ({
          ...block,
        })),
      }),
    ).toHaveLength(0);
    expect(
      props(CreatePageDto, {
        ...base,
        content: Array.from({ length: MAX_CONTENT_BLOCKS + 1 }, () => ({
          ...block,
        })),
      }),
    ).toContain('content');
  });

  it('doan long nhau sai kieu van bi chan', () => {
    expect(
      props(CreateNewsPostDto, { ...newsWith(1), content: [{ vi: 123 }] }),
    ).toContain('content');
  });
});
