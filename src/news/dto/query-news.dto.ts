import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

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
}
