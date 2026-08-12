import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateNewsCategoryDto } from './create-news-category.dto';
import { UpdateNewsCategoryDto } from './update-news-category.dto';

/**
 * Slug chuyên mục là **khoá tự nhiên và URL công khai**.
 *
 * Trước đây DTO tạo chuyên mục không có ràng buộc hình dạng nào, trong khi bộ
 * lọc `GET /news?categorySlug=` lại kiểm rất chặt — tạo được chuyên mục
 * `Tin Dự Án` (201) mà chính website không mở nổi (400 ở bước lọc).
 *
 * Hai bộ test dưới đây khoá lại **cùng một quy tắc** ở hai đầu, và
 * `news-category-slug.ts` là nơi duy nhất khai báo nó.
 */
async function validateCreate(payload: Record<string, unknown>) {
  return validate(plainToInstance(CreateNewsCategoryDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

async function validateUpdate(payload: Record<string, unknown>) {
  return validate(plainToInstance(UpdateNewsCategoryDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

function failed(errors: Awaited<ReturnType<typeof validate>>) {
  return errors.map((error) => error.property);
}

const name = { vi: 'Tin dự án' };

describe('CreateNewsCategoryDto', () => {
  it('payload hợp lệ tối thiểu đi qua', async () => {
    expect(await validateCreate({ slug: 'tin-du-an', name })).toHaveLength(0);
  });

  it('slug thường gặp đi qua', async () => {
    for (const slug of ['tin-du-an', 'tincongty', 'kien-truc-2026', 'a1b']) {
      expect(await validateCreate({ slug, name })).toHaveLength(0);
    }
  });

  it('slug sai định dạng bị từ chối', async () => {
    const invalid = [
      'Tin Du An', // chữ hoa + khoảng trắng
      'tin--du-an', // hai gạch liền
      '-tin-du-an', // gạch đầu
      'tin-du-an-', // gạch cuối
      'tin_du_an', // gạch dưới
      'tin-dự-án', // dấu tiếng Việt
      'tin/du-an',
      "tin'--",
    ];
    for (const slug of invalid) {
      expect(failed(await validateCreate({ slug, name }))).toContain('slug');
    }
  });

  it('slug ngắn hơn 3 ký tự bị từ chối', async () => {
    for (const slug of ['a', 'ab']) {
      expect(failed(await validateCreate({ slug, name }))).toContain('slug');
    }
    expect(await validateCreate({ slug: 'abc', name })).toHaveLength(0);
  });

  it('slug dài hơn 160 ký tự bị từ chối', async () => {
    expect(
      failed(await validateCreate({ slug: 'a'.repeat(161), name })),
    ).toContain('slug');
    expect(await validateCreate({ slug: 'a'.repeat(160), name })).toHaveLength(
      0,
    );
  });

  it('tên tiếng Việt bắt buộc, tiếng Anh tuỳ chọn', async () => {
    expect(failed(await validateCreate({ slug: 'tin-du-an' }))).toContain(
      'name',
    );
    expect(
      failed(await validateCreate({ slug: 'tin-du-an', name: { vi: '  ' } })),
    ).toContain('name');
    expect(
      await validateCreate({
        slug: 'tin-du-an',
        name: { vi: 'Tin dự án', en: 'Project news' },
      }),
    ).toHaveLength(0);
  });

  it('order âm bị từ chối, 0 hợp lệ', async () => {
    expect(
      failed(await validateCreate({ slug: 'tin-du-an', name, order: -1 })),
    ).toContain('order');
    expect(
      await validateCreate({ slug: 'tin-du-an', name, order: 0 }),
    ).toHaveLength(0);
  });

  it('field lạ bị từ chối chứ không bị bỏ qua', async () => {
    const errors = await validateCreate({
      slug: 'tin-du-an',
      name,
      description: 'mô tả',
    });
    expect(failed(errors)).toContain('description');
  });
});

describe('UpdateNewsCategoryDto — slug bất biến', () => {
  it('sửa tên song ngữ được', async () => {
    expect(
      await validateUpdate({ name: { vi: 'Tin dự án', en: 'Project news' } }),
    ).toHaveLength(0);
  });

  it('sửa thứ tự được', async () => {
    expect(await validateUpdate({ order: 3 })).toHaveLength(0);
  });

  it('payload rỗng hợp lệ (mọi field đều tuỳ chọn)', async () => {
    expect(await validateUpdate({})).toHaveLength(0);
  });

  it('GỬI KÈM slug bị TỪ CHỐI — slug khoá sau khi tạo', async () => {
    // Không phải "bị bỏ qua âm thầm": client phải biết thao tác này không hợp lệ,
    // vì đổi slug làm chết URL công khai đã nằm trong sitemap.
    expect(failed(await validateUpdate({ slug: 'slug-moi' }))).toContain(
      'slug',
    );
    expect(
      failed(await validateUpdate({ name: { vi: 'Tên mới' }, slug: 'khac' })),
    ).toContain('slug');
  });

  it('order âm vẫn bị từ chối khi cập nhật', async () => {
    expect(failed(await validateUpdate({ order: -5 }))).toContain('order');
  });
});
