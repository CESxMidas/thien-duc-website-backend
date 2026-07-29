import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import {
  LongTranslatedTextDto,
  MAX_LONG_TEXT_LENGTH,
} from './long-translated-text.dto';
import { CreateNewsPostDto } from '../../news/dto/create-news-post.dto';
import { UpdateNewsPostDto } from '../../news/dto/update-news-post.dto';
import { CreatePageDto } from '../../pages/dto/create-page.dto';
import { UpdatePageDto } from '../../pages/dto/update-page.dto';

/**
 * Hồi quy cho việc nâng trần nội dung dài 5.000 → 100.000 ký tự/đoạn.
 *
 * Lỗi gốc: biên tập viên dán một bài dài vào ô "Nội dung" mà không có dòng
 * trống tách đoạn → cả bài nằm trong `content[0].vi` → 400
 * "content.0.vi must be shorter than or equal to 5000 characters".
 */

const OLD_LIMIT = 5_000;

type DtoClass<T> = new () => T;

async function validateDto<T extends object>(
  cls: DtoClass<T>,
  payload: Record<string, unknown>,
): Promise<ValidationError[]> {
  return validate(plainToInstance(cls, payload));
}

/** Gom `property` của lỗi lồng nhau thành đường dẫn kiểu `content.0.vi`. */
function errorPaths(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((error) => {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    const children = error.children ?? [];
    return children.length > 0
      ? errorPaths(children, path)
      : [`${path}: ${Object.keys(error.constraints ?? {}).join(',')}`];
  });
}

function hasErrorAt(errors: ValidationError[], path: string): boolean {
  return errorPaths(errors).some((entry) => entry.startsWith(`${path}:`));
}

const validPage = (content: unknown[]) => ({
  slug: 'gioi-thieu',
  title: { vi: 'Giới thiệu', en: 'About' },
  content,
});

const validPost = (content: unknown[]) => ({
  slug: 'le-khoi-cong',
  title: { vi: 'Lễ khởi công', en: 'Groundbreaking' },
  summary: { vi: 'Tóm tắt sự kiện khởi công', en: 'Event summary' },
  content,
});

describe('LongTranslatedTextDto — trần 100.000 ký tự', () => {
  it('trần được khai đúng 100.000', () => {
    expect(MAX_LONG_TEXT_LENGTH).toBe(100_000);
  });

  describe.each([
    ['vi', (text: string) => ({ vi: text })],
    ['en', (text: string) => ({ vi: 'Đoạn tiếng Việt', en: text })],
  ])('field %s', (field, build) => {
    it.each([
      ['5.001 (vượt trần cũ 5.000)', OLD_LIMIT + 1],
      ['50.000', 50_000],
      ['đúng 100.000 (biên trên)', MAX_LONG_TEXT_LENGTH],
    ])('chấp nhận %s ký tự', async (_label, length) => {
      const errors = await validateDto(
        LongTranslatedTextDto,
        build('a'.repeat(length)),
      );
      expect(errorPaths(errors)).toEqual([]);
    });

    it('chặn 100.001 ký tự (vượt trần 1 ký tự)', async () => {
      const errors = await validateDto(
        LongTranslatedTextDto,
        build('a'.repeat(MAX_LONG_TEXT_LENGTH + 1)),
      );
      expect(hasErrorAt(errors, field)).toBe(true);
    });
  });

  it('vẫn bắt buộc vi là chuỗi', async () => {
    const errors = await validateDto(LongTranslatedTextDto, { vi: 123 });
    expect(hasErrorAt(errors, 'vi')).toBe(true);
  });

  it('en vẫn là tùy chọn', async () => {
    const errors = await validateDto(LongTranslatedTextDto, {
      vi: 'Chỉ có VI',
    });
    expect(errorPaths(errors)).toEqual([]);
  });
});

describe('content[] trong DTO create/update — validate từng phần tử mảng', () => {
  const cases: Array<[string, DtoClass<object>, (c: unknown[]) => object]> = [
    ['CreatePageDto', CreatePageDto, validPage],
    ['UpdatePageDto', UpdatePageDto, validPage],
    ['CreateNewsPostDto', CreateNewsPostDto, validPost],
    ['UpdateNewsPostDto', UpdateNewsPostDto, validPost],
  ];

  describe.each(cases)('%s', (_name, dto, build) => {
    it.each([
      ['5.001', OLD_LIMIT + 1],
      ['50.000', 50_000],
      ['đúng 100.000', MAX_LONG_TEXT_LENGTH],
    ])('chấp nhận đoạn %s ký tự ở cả vi lẫn en', async (_label, length) => {
      const text = 'a'.repeat(length);
      const errors = await validateDto(
        dto,
        build([{ vi: text, en: text }]) as Record<string, unknown>,
      );
      expect(errorPaths(errors)).toEqual([]);
    });

    it('chặn đoạn 100.001 ký tự ở vi, báo đúng vị trí trong mảng', async () => {
      const errors = await validateDto(
        dto,
        build([
          { vi: 'Đoạn đầu hợp lệ' },
          { vi: 'a'.repeat(MAX_LONG_TEXT_LENGTH + 1) },
        ]) as Record<string, unknown>,
      );
      // Phần tử thứ 2 mới sai → đường dẫn phải là content.1.vi, không phải .0.
      expect(hasErrorAt(errors, 'content.1.vi')).toBe(true);
      expect(hasErrorAt(errors, 'content.0.vi')).toBe(false);
    });

    it('chặn đoạn 100.001 ký tự ở en', async () => {
      const errors = await validateDto(
        dto,
        build([
          { vi: 'Đoạn hợp lệ', en: 'a'.repeat(MAX_LONG_TEXT_LENGTH + 1) },
        ]) as Record<string, unknown>,
      );
      expect(hasErrorAt(errors, 'content.0.en')).toBe(true);
    });

    it('tái hiện lỗi gốc: cả bài dồn vào content[0].vi vẫn đi qua', async () => {
      // ~15.000 từ trong **một** đoạn: kịch bản dán bài không có dòng trống.
      const article = 'nội dung bài viết dài '.repeat(4_000);
      expect(article.length).toBeGreaterThan(OLD_LIMIT);
      expect(article.length).toBeLessThanOrEqual(MAX_LONG_TEXT_LENGTH);

      const errors = await validateDto(
        dto,
        build([{ vi: article }]) as Record<string, unknown>,
      );
      expect(errorPaths(errors)).toEqual([]);
    });
  });
});

describe('field ngắn giữ nguyên trần 5.000 (không bị nâng lây)', () => {
  it.each([
    ['CreatePageDto.title', CreatePageDto, validPage],
    ['CreateNewsPostDto.title', CreateNewsPostDto, validPost],
  ] as Array<[string, DtoClass<object>, (c: unknown[]) => object]>)(
    '%s vẫn chặn ở 5.001 ký tự',
    async (_name, dto, build) => {
      const errors = await validateDto(dto, {
        ...(build([{ vi: 'Đoạn hợp lệ' }]) as Record<string, unknown>),
        title: { vi: 'a'.repeat(OLD_LIMIT + 1) },
      });
      expect(hasErrorAt(errors, 'title.vi')).toBe(true);
    },
  );

  it('CreateNewsPostDto.summary vẫn chặn ở 5.001 ký tự', async () => {
    const errors = await validateDto(CreateNewsPostDto, {
      ...validPost([{ vi: 'Đoạn hợp lệ' }]),
      summary: { vi: 'a'.repeat(OLD_LIMIT + 1) },
    });
    expect(hasErrorAt(errors, 'summary.vi')).toBe(true);
  });
});
