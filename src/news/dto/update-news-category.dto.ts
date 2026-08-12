import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateNewsCategoryDto } from './create-news-category.dto';

/**
 * Sửa chuyên mục — **không bao gồm `slug`**.
 *
 * Slug là URL công khai đã nằm trong sitemap và có thể đã được lập chỉ mục;
 * đổi nó làm chết `/tin-tuc/danh-muc/<slug-cũ>`. Dự án chọn chính sách "khoá
 * slug sau khi tạo" thay vì dựng hệ thống lịch sử chuyển hướng — với 4 chuyên
 * mục gần như không bao giờ đổi tên, đó là giải pháp nhỏ nhất mà vẫn chắc.
 *
 * Chính sách này phải nằm ở **hợp đồng API**, không chỉ ở giao diện Admin: một
 * API tuyên bố slug sửa được trong khi Admin khoá lại là mời gọi client khác
 * (hoặc chính chúng ta sau này) phá URL công khai.
 *
 * `ValidationPipe` bật `forbidNonWhitelisted`, nên gửi kèm `slug` bị **từ chối
 * 400** chứ không bị âm thầm bỏ qua — client biết ngay là thao tác không hợp lệ.
 *
 * Đã kiểm trước khi gỡ: không consumer nào gửi `slug` trong PATCH — Admin khai
 * `UpdateNewsCategoryInput { name?, order? }`, frontend công khai chỉ GET.
 */
export class UpdateNewsCategoryDto extends PartialType(
  OmitType(CreateNewsCategoryDto, ['slug'] as const),
) {}
