import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryNewsDto } from './query-news.dto';

/**
 * `GET /news` là route **công khai, không đăng nhập**, và `categorySlug` đi
 * thẳng vào mệnh đề `where`. Ràng buộc hình dạng ở đây giữ cho tập URL chuyên
 * mục là hữu hạn và đếm được — điều kiện SEO của trang danh mục, đồng thời
 * chặn ký tự lạ từ trước khi chạm tầng dữ liệu.
 */
async function validatePayload(payload: Record<string, unknown>) {
  const dto = plainToInstance(QueryNewsDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

function failedProperties(errors: Awaited<ReturnType<typeof validate>>) {
  return errors.map((error) => error.property);
}

describe('QueryNewsDto.categorySlug', () => {
  it('bỏ trống hoàn toàn vẫn hợp lệ (danh sách không lọc)', async () => {
    expect(await validatePayload({})).toHaveLength(0);
  });

  it('slug thường gặp đi qua', async () => {
    for (const slug of ['tin-du-an', 'tuyendung', 'su-kien-2026', 'a1']) {
      expect(await validatePayload({ categorySlug: slug })).toHaveLength(0);
    }
  });

  it('chữ hoa, khoảng trắng và dấu tiếng Việt bị từ chối', async () => {
    for (const slug of ['Tin-Du-An', 'tin du an', 'tin-dự-án']) {
      expect(
        failedProperties(await validatePayload({ categorySlug: slug })),
      ).toContain('categorySlug');
    }
  });

  it('gạch ngang thừa ở đầu/cuối hoặc lặp bị từ chối', async () => {
    for (const slug of ['-tin-du-an', 'tin-du-an-', 'tin--du-an', '-', '']) {
      expect(
        failedProperties(await validatePayload({ categorySlug: slug })),
      ).toContain('categorySlug');
    }
  });

  it('ký tự có nghĩa trong SQL/URL bị từ chối', async () => {
    for (const slug of [
      "tin'--",
      'tin;drop',
      'tin/du-an',
      'tin%20an',
      '../..',
    ]) {
      expect(
        failedProperties(await validatePayload({ categorySlug: slug })),
      ).toContain('categorySlug');
    }
  });

  it('slug quá dài (>160) bị từ chối', async () => {
    const slug = 'a'.repeat(161);
    expect(
      failedProperties(await validatePayload({ categorySlug: slug })),
    ).toContain('categorySlug');
  });

  it('field lạ bị từ chối chứ không bị bỏ qua (forbidNonWhitelisted)', async () => {
    const errors = await validatePayload({ category: 'tin-du-an' });
    expect(failedProperties(errors)).toContain('category');
  });

  it('lọc chuyên mục đi kèm phân trang vẫn hợp lệ', async () => {
    const errors = await validatePayload({
      page: 2,
      limit: 9,
      categorySlug: 'tin-du-an',
    });
    expect(errors).toHaveLength(0);
  });
});
