import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Slug chuyên mục hợp lệ: chữ thường ASCII, số và dấu gạch ngang; không mở đầu
 * hay kết thúc bằng gạch ngang, không có hai gạch liền.
 *
 * Chặn ngay ở tầng DTO thay vì tin vào Prisma: giá trị này đi thẳng vào mệnh đề
 * `where` của một route **công khai, không đăng nhập**. Prisma vốn đã tham số
 * hóa nên không có SQL injection, nhưng ràng buộc hình dạng giữ cho URL chuyên
 * mục là một tập hữu hạn, đếm được — đúng điều kiện SEO của trang danh mục.
 */
export const NEWS_CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Số bài mỗi trang khi client gửi `page` mà không gửi `limit`. */
export const NEWS_DEFAULT_PAGE_SIZE = 9;

/**
 * Trần cứng cho `limit`. Route công khai không đăng nhập — không được để người
 * lạ kéo cả kho bài trong một request (`?limit=100000`) làm nặng DB và mạng.
 */
export const NEWS_MAX_PAGE_SIZE = 50;

/**
 * Tham số phân trang **tùy chọn** của `GET /news`.
 *
 * Không gửi `page` lẫn `limit` → controller giữ nguyên hành vi cũ: trả **mảng
 * phẳng** toàn bộ bài đã đăng. Đây là điều kiện để không phá các consumer đang
 * chạy (trang chủ, trang tin, sitemap). Chỉ khi có ít nhất một trong hai tham
 * số thì response mới chuyển sang envelope phân trang.
 */
export class QueryNewsDto {
  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    description: 'Trang muốn lấy, tính từ 1. Bỏ trống = không phân trang.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: NEWS_MAX_PAGE_SIZE,
    default: NEWS_DEFAULT_PAGE_SIZE,
    description: `Số bài mỗi trang (tối đa ${NEWS_MAX_PAGE_SIZE}).`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NEWS_MAX_PAGE_SIZE)
  limit?: number;

  /**
   * Lọc theo slug chuyên mục. Bỏ trống → giữ nguyên hành vi cũ (mọi chuyên mục).
   *
   * PHẢI khai báo ở đây: `ValidationPipe` bật `forbidNonWhitelisted`, nên field
   * không có trong DTO bị **từ chối 400** chứ không phải bị bỏ qua.
   */
  @ApiPropertyOptional({
    example: 'tin-du-an',
    maxLength: 160,
    description:
      'Slug chuyên mục cần lọc. Chỉ có tác dụng cùng `page`/`limit` (nhánh phân trang).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Matches(NEWS_CATEGORY_SLUG_PATTERN, {
    message: 'categorySlug chỉ gồm chữ thường, số và dấu gạch ngang',
  })
  categorySlug?: string;
}
