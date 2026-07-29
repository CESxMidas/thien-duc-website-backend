import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Trần cho **một đoạn nội dung dài** (bài viết, trang tĩnh).
 *
 * Vì sao tách khỏi `TranslatedTextDto` (5000): trần 5000 được đặt ở task →3 cho
 * các field **ngắn** (tiêu đề, tóm tắt, chú thích ảnh…) và vẫn đúng ở đó. Nhưng
 * `content[]` là nội dung biên tập thật: một đoạn văn xuôi tiếng Việt dài
 * >5000 ký tự là hoàn toàn hợp lệ, và Admin CMS chỉ tách đoạn theo **dòng
 * trống** — biên tập viên dán cả bài không có dòng trống thì toàn bộ bài rơi
 * vào `content[0].vi` và bị chặn 400 dù nội dung chính đáng.
 *
 * Vì sao 100_000 chứ không bỏ hẳn: vẫn cần một trần chống payload khổng lồ.
 * 100_000 ký tự ≈ 15.000–20.000 từ tiếng Việt cho **mỗi đoạn**, thừa sức cho
 * bài dài nhất mà vẫn giữ payload ở mức ~200KB/đoạn (UTF-8), tức vẫn dưới trần
 * body parser. Cột Postgres là `jsonb` nên không có ràng buộc độ dài ở DB.
 */
export const MAX_LONG_TEXT_LENGTH = 100_000;

/**
 * Field song ngữ cho nội dung dài. Cùng shape `{ vi, en? }` với
 * `TranslatedTextDto`, chỉ khác trần độ dài — client không phải đổi gì.
 *
 * Không `extends TranslatedTextDto`: class-validator **kế thừa cả decorator**,
 * nên `@MaxLength(5000)` của lớp cha vẫn chạy và tiếp tục chặn ở 5000. Phải
 * khai báo độc lập.
 */
export class LongTranslatedTextDto {
  @ApiProperty({ maxLength: MAX_LONG_TEXT_LENGTH })
  @IsString()
  @MaxLength(MAX_LONG_TEXT_LENGTH)
  vi!: string;

  @ApiProperty({ required: false, maxLength: MAX_LONG_TEXT_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LONG_TEXT_LENGTH)
  en?: string;
}
