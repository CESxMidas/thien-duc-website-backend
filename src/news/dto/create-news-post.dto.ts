import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsDefined,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { LongTranslatedTextDto } from '../../common/dto/long-translated-text.dto';
import { TranslatedTextDto } from '../../common/dto/translated-text.dto';
import {
  IsSafeImageRef,
  IsSafeReferenceUrl,
} from '../../common/validators/safe-url';
import { IsNotBlank } from '../../common/validators/not-blank';
import { MAX_CONTENT_BLOCKS } from '../../common/dto/content-blocks';

export class CreateNewsPostDto {
  @ApiProperty({
    maxLength: 160,
    description: 'Slug bài viết dùng trên URL công khai.',
    example: 'le-khoi-cong-fancy-tower',
  })
  @IsString()
  @MaxLength(160)
  @IsNotBlank()
  slug!: string;

  @ApiProperty({
    type: TranslatedTextDto,
    description: 'Tiêu đề bài viết hiển thị ở danh sách, chi tiết và SEO.',
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  title!: TranslatedTextDto;

  /**
   * Nội dung bài viết là **mảng đoạn văn**, mỗi đoạn là một field song ngữ —
   * khớp `NewsPostDto.content: LocalizedText[]` mà frontend đang đọc.
   *
   * Dùng `LongTranslatedTextDto` (trần 100_000/đoạn) chứ không phải
   * `TranslatedTextDto` (5000): đây là nội dung biên tập dài, xem lý do ở
   * `common/dto/long-translated-text.dto.ts`.
   */
  @ApiProperty({
    type: [LongTranslatedTextDto],
    required: false,
    description: 'Nội dung bài viết, mỗi phần tử là một đoạn văn song ngữ.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LongTranslatedTextDto)
  @ArrayMaxSize(MAX_CONTENT_BLOCKS)
  content?: LongTranslatedTextDto[];

  // UUID (36 ký tự) — 60 cho dư địa nếu đổi định dạng id.
  @ApiProperty({
    required: false,
    maxLength: 60,
    description: 'ID chuyên mục tin tức mà bài viết thuộc về.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  categoryId?: string;

  @ApiProperty({
    required: false,
    maxLength: 120,
    description: 'Nguồn hoặc tác giả hiển thị cho bài viết.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  author?: string;

  @ApiProperty({
    required: false,
    maxLength: 500,
    nullable: true,
    description: 'URL nguồn tham khảo bên ngoài, nếu có.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsSafeReferenceUrl()
  referenceUrl?: string | null;

  @ApiProperty({
    required: false,
    maxLength: 500,
    description: 'Ảnh đại diện của bài viết.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsSafeImageRef()
  image?: string;

  @ApiProperty({
    type: [String],
    required: false,
    maxItems: 50,
    description: 'Danh sách ảnh thư viện dùng trong bài viết.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  @IsSafeImageRef({ each: true })
  gallery?: string[];

  @ApiProperty({
    required: false,
    description:
      'Ngày diễn ra sự kiện được bài viết nhắc tới, nếu khác ngày đăng.',
  })
  @IsOptional()
  @IsDateString()
  eventDate?: string;

  /**
   * KHÔNG có `scheduledAt` ở đây — cố ý, đây là chốt bảo mật.
   *
   * `POST /news` và `PATCH /news/:slug` (qua `UpdateNewsPostDto = PartialType`)
   * mở cho **EDITOR**, trong khi `assertContentStatusTransition` chỉ cho EDITOR
   * đi đúng một bước `DRAFT → PENDING` — EDITOR không được đăng bài. Nhưng
   * `scheduledAt` từng nằm trong DTO này mà không kiểm vai trò, cũng không kiểm
   * thời điểm: một EDITOR đặt `scheduledAt` vào quá khứ là `NewsSchedulerService`
   * (lượt kế tiếp, ≤5 phút) đăng bài lên website, bỏ qua trọn vẹn luồng duyệt.
   *
   * Vì `ValidationPipe` bật `whitelist` + `forbidNonWhitelisted`, việc gỡ field
   * khỏi DTO không phải là "bỏ qua field" mà là **từ chối 400** — đúng thứ ta
   * muốn: client cũ gửi nhầm sẽ thấy lỗi thay vì âm thầm mất dữ liệu.
   *
   * Đặt lịch sẽ có route lệnh riêng chốt ADMIN+ ở batch sau. Đừng thêm lại field
   * này vào DTO nội dung chung.
   *
   * `scheduledAt` vẫn được **đọc** bình thường trong response — chốt này chỉ
   * đóng đường GHI.
   */
}
