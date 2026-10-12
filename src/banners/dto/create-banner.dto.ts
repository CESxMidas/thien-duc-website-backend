import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TranslatedTextDto } from '../../common/dto/translated-text.dto';
import { IsIsoInstant } from '../../common/validators/iso-instant';
import {
  IsSafeImageRef,
  IsSafeInternalPath,
} from '../../common/validators/safe-url';

export class CreateBannerDto {
  @ApiProperty({
    maxLength: 500,
    description: 'Ảnh nền của banner trang chủ.',
  })
  @IsString()
  @MaxLength(500)
  @IsSafeImageRef()
  image!: string;

  @ApiProperty({
    required: false,
    type: TranslatedTextDto,
    description: 'Nhãn nhỏ phía trên tiêu đề banner.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  eyebrow?: TranslatedTextDto | null;

  @ApiProperty({
    required: false,
    type: TranslatedTextDto,
    description: 'Tiêu đề chính trên banner.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  title?: TranslatedTextDto | null;

  @ApiProperty({
    required: false,
    type: TranslatedTextDto,
    description: 'Mô tả phụ dưới tiêu đề banner.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  subtitle?: TranslatedTextDto | null;

  @ApiProperty({
    maxLength: 500,
    description: 'Đường dẫn nội bộ khi bấm nút CTA trên banner.',
    example: '/du-an/khu-do-thi-hung-phu',
  })
  @IsString()
  @MaxLength(500)
  @IsSafeInternalPath()
  href!: string;

  @ApiProperty({
    required: false,
    type: TranslatedTextDto,
    description: 'Nhãn nút CTA hiển thị trên banner.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  ctaLabel?: TranslatedTextDto | null;

  // Giá trị CSS object-position, vd "center 30%" — rất ngắn.
  @ApiProperty({
    required: false,
    maxLength: 60,
    description:
      'Giá trị CSS object-position để canh ảnh banner, ví dụ center 55%.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  objectPosition?: string;

  @ApiProperty({
    required: false,
    description: 'Thứ tự hiển thị của banner, số nhỏ đứng trước.',
  })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiProperty({
    required: false,
    description: 'Bật/tắt banner trên website công khai.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // ── CỬA SỔ HIỂN THỊ ──────────────────────────────────────────────────────
  // Đây là CẤU HÌNH banner, không phải lệnh xuất bản: vì vậy nó đi thẳng qua
  // create/update thông thường, không có endpoint lệnh riêng như
  // `POST /news/:id/schedule`. Không có `scheduledAt`/`publishedAt`, không có
  // trạng thái SCHEDULED nào được lưu xuống.
  //
  // `@IsOptional()` ở class-validator bỏ qua CẢ `null` LẪN `undefined` — đúng
  // thứ cần ở đây: `undefined` = không đụng tới, `null` = xoá biên. Cả hai đều
  // không phải chuỗi nên không được đem đi kiểm định dạng ISO.
  //
  // Bắt buộc instant ISO có múi giờ tường minh (`Z` hoặc `±HH:MM`) — dùng lại
  // đúng `IsIsoInstant` của luồng đặt lịch. Chuỗi kiểu `2026-09-01T08:00` không
  // mang múi giờ và sẽ được `new Date()` diễn giải theo múi giờ TIẾN TRÌNH:
  // backend chạy UTC trên Render, máy biên tập viên chạy UTC+7, cùng payload ra
  // hai thời điểm lệch nhau 7 tiếng mà không bên nào báo lỗi.

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Mốc bắt đầu hiển thị, ISO-8601 kèm múi giờ (vd 2026-09-01T08:00:00+07:00). Bỏ trống/null = có hiệu lực ngay.',
  })
  @IsOptional()
  @IsIsoInstant()
  displayFrom?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Mốc hết hiển thị, ISO-8601 kèm múi giờ. Bỏ trống/null = không giới hạn ngày kết thúc. Đúng tại mốc này banner đã tắt.',
  })
  @IsOptional()
  @IsIsoInstant()
  displayUntil?: string | null;
}
