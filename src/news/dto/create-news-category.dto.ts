import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TranslatedTextDto } from '../../common/dto/translated-text.dto';
import { IsNotBlank } from '../../common/validators/not-blank';
import {
  NEWS_CATEGORY_SLUG_MAX_LENGTH,
  NEWS_CATEGORY_SLUG_MESSAGE,
  NEWS_CATEGORY_SLUG_MIN_LENGTH,
  NEWS_CATEGORY_SLUG_PATTERN,
} from '../news-category-slug';

export class CreateNewsCategoryDto {
  /**
   * Slug là **khoá tự nhiên** của chuyên mục và là URL công khai
   * (`/tin-tuc/danh-muc/<slug>`). Ràng buộc hình dạng ở đây dùng chung hằng số
   * với bộ lọc `GET /news?categorySlug=` — hai phía lệch nhau thì tạo được
   * chuyên mục mà website không mở được (xem `news-category-slug.ts`).
   */
  @ApiProperty({
    example: 'tin-du-an',
    minLength: NEWS_CATEGORY_SLUG_MIN_LENGTH,
    maxLength: NEWS_CATEGORY_SLUG_MAX_LENGTH,
    pattern: NEWS_CATEGORY_SLUG_PATTERN.source,
    description: NEWS_CATEGORY_SLUG_MESSAGE,
  })
  @IsString()
  @MinLength(NEWS_CATEGORY_SLUG_MIN_LENGTH)
  @MaxLength(NEWS_CATEGORY_SLUG_MAX_LENGTH)
  @IsNotBlank()
  @Matches(NEWS_CATEGORY_SLUG_PATTERN, { message: NEWS_CATEGORY_SLUG_MESSAGE })
  slug!: string;

  /** `vi` bắt buộc, `en` tuỳ chọn — xem `TranslatedTextDto`. */
  @ApiProperty({ type: TranslatedTextDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  name!: TranslatedTextDto;

  /**
   * Thứ tự hiển thị. Cho phép trùng: danh sách sắp `[order asc, slug asc]` nên
   * trùng vẫn ra thứ tự ổn định giữa các lần chạy. `@Min(0)` chặn số âm — âm
   * không sai về kỹ thuật nhưng luôn là dấu hiệu client tính nhầm.
   */
  @ApiProperty({ required: false, default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order?: number;
}
