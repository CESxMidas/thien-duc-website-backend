import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateBannerDto } from '../../banners/dto/create-banner.dto';
import { CreateCooperationProjectDto } from '../../cooperation/dto/create-cooperation-project.dto';
import { CreateNewsCategoryDto } from '../../news/dto/create-news-category.dto';
import { CreateNewsPostDto } from '../../news/dto/create-news-post.dto';
import { UpdateNewsPostDto } from '../../news/dto/update-news-post.dto';
import { CreatePageDto } from '../../pages/dto/create-page.dto';
import { UpdatePageDto } from '../../pages/dto/update-page.dto';
import { CreateProjectDto } from '../../projects/dto/create-project.dto';
import { CreateProjectItemDto } from '../../projects/dto/create-project-item.dto';
import { UpdateProjectDto } from '../../projects/dto/update-project.dto';

/**
 * Hồi quy AUDIT-M1 D2 — **field song ngữ bắt buộc phải thực sự bắt buộc.**
 *
 * `@ValidateNested()` một mình KHÔNG chặn `undefined`: class-validator bỏ qua
 * giá trị undefined nên DTO lọt qua ValidationPipe, rồi Prisma mới ném
 * `PrismaClientValidationError: Argument \`title\` is missing` → client nhận
 * **500** cho một payload sai. Đo được trước bản sửa trên cả 4 module:
 * `POST /news`, `/projects`, `/pages`, `/banners`.
 *
 * `@IsDefined()` đưa nó về **400** ở đúng tầng validate. Test này khoá hợp đồng
 * đó, và khẳng định DTO `Update*` (PartialType) KHÔNG bị siết theo — PATCH từng
 * phần vẫn phải gửi được payload thiếu field.
 */

/** Có lỗi validate ở đúng property này không. */
function hasErrorOn(
  dtoClass: new () => object,
  payload: Record<string, unknown>,
  property: string,
): boolean {
  const instance = plainToInstance(dtoClass, payload);
  return validateSync(instance).some((error) => error.property === property);
}

describe('field song ngữ bắt buộc — thiếu thì bị chặn ở tầng DTO (400, không phải 500)', () => {
  // [nhãn, DTO, payload đã đủ MỌI field bắt buộc khác, field bị bỏ trống]
  const cases: Array<
    [string, new () => object, Record<string, unknown>, string]
  > = [
    [
      'CreateNewsPostDto.title',
      CreateNewsPostDto,
      { slug: 'a', summary: { vi: 's' } },
      'title',
    ],
    [
      'CreateNewsPostDto.summary',
      CreateNewsPostDto,
      { slug: 'a', title: { vi: 't' } },
      'summary',
    ],
    [
      'CreateNewsCategoryDto.name',
      CreateNewsCategoryDto,
      { slug: 'a' },
      'name',
    ],
    [
      'CreateProjectDto.title',
      CreateProjectDto,
      { slug: 'a', summary: { vi: 's' }, status: 'DA_BAN_GIAO' },
      'title',
    ],
    [
      'CreateProjectDto.summary',
      CreateProjectDto,
      { slug: 'a', title: { vi: 't' }, status: 'DA_BAN_GIAO' },
      'summary',
    ],
    [
      'CreateProjectItemDto.title',
      CreateProjectItemDto,
      { slug: 'a' },
      'title',
    ],
    [
      'CreatePageDto.title',
      CreatePageDto,
      { slug: 'a', content: [{ vi: 'c' }] },
      'title',
    ],
    [
      'CreateBannerDto.title',
      CreateBannerDto,
      { image: '/a.png', href: '/du-an' },
      'title',
    ],
    [
      'CreateCooperationProjectDto.name',
      CreateCooperationProjectDto,
      {
        location: { vi: 'l' },
        role: { vi: 'r' },
        partner: { vi: 'p' },
        scale: { vi: 's' },
        status: { vi: 'st' },
      },
      'name',
    ],
    [
      'CreateCooperationProjectDto.partner',
      CreateCooperationProjectDto,
      {
        name: { vi: 'n' },
        location: { vi: 'l' },
        role: { vi: 'r' },
        scale: { vi: 's' },
        status: { vi: 'st' },
      },
      'partner',
    ],
  ];

  it.each(cases)(
    '%s: thiếu → có lỗi validate',
    (_label, dto, payload, prop) => {
      expect(hasErrorOn(dto, payload, prop)).toBe(true);
    },
  );

  it.each(cases)(
    '%s: có giá trị hợp lệ → KHÔNG báo lỗi field đó',
    (_label, dto, payload, prop) => {
      const full = { ...payload, [prop]: { vi: 'giá trị hợp lệ' } };
      expect(hasErrorOn(dto, full, prop)).toBe(false);
    },
  );

  it('null cũng bị chặn (không chỉ undefined)', () => {
    expect(
      hasErrorOn(
        CreateNewsPostDto,
        { slug: 'a', summary: { vi: 's' }, title: null },
        'title',
      ),
    ).toBe(true);
  });
});

describe('DTO Update (PartialType) KHÔNG bị siết theo — PATCH từng phần vẫn hợp lệ', () => {
  it('UpdateNewsPostDto chỉ gửi title vẫn hợp lệ (không đòi summary)', () => {
    expect(
      hasErrorOn(UpdateNewsPostDto, { title: { vi: 't' } }, 'summary'),
    ).toBe(false);
  });

  it('UpdateNewsPostDto payload rỗng vẫn hợp lệ', () => {
    const errors = validateSync(plainToInstance(UpdateNewsPostDto, {}));
    expect(errors).toHaveLength(0);
  });

  it('UpdateProjectDto chỉ gửi summary vẫn hợp lệ (không đòi title/status)', () => {
    const errors = validateSync(
      plainToInstance(UpdateProjectDto, { summary: { vi: 's' } }),
    );
    expect(errors).toHaveLength(0);
  });

  it('UpdatePageDto payload rỗng vẫn hợp lệ', () => {
    const errors = validateSync(plainToInstance(UpdatePageDto, {}));
    expect(errors).toHaveLength(0);
  });

  it('Update vẫn chặn giá trị SAI KIỂU (không phải bỏ hết validate)', () => {
    expect(
      hasErrorOn(UpdateNewsPostDto, { title: 'chuỗi trần' }, 'title'),
    ).toBe(true);
  });
});
