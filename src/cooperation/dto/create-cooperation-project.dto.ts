import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TranslatedTextDto } from '../../common/dto/translated-text.dto';
import { IsSafeImageRef } from '../../common/validators/safe-url';

export class CreateCooperationProjectDto {
  @ApiProperty({ type: TranslatedTextDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  name!: TranslatedTextDto;

  @ApiProperty({ type: TranslatedTextDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  location!: TranslatedTextDto;

  @ApiProperty({ type: TranslatedTextDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  role!: TranslatedTextDto;

  @ApiProperty({ type: TranslatedTextDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  partner!: TranslatedTextDto;

  @ApiProperty({ type: TranslatedTextDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  scale!: TranslatedTextDto;

  @ApiProperty({ type: TranslatedTextDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  status!: TranslatedTextDto;

  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsSafeImageRef()
  image?: string;

  /*
   * KHÔNG có `contentStatus` ở đây — cố ý, đây là chốt bảo mật.
   *
   * `POST /cooperation` và `PATCH /cooperation/:id` đều mở cho **EDITOR** (xem
   * `@Roles` ở `cooperation.controller.ts`), trong khi bậc thang duyệt chỉ cho
   * EDITOR đi `DRAFT → PENDING` qua `assertContentStatusTransition`. Field này
   * từng nằm trong DTO, và `update()` spread thẳng `...dto` xuống Prisma mà
   * không kiểm vai trò: chỉ cần gửi kèm `{"contentStatus":"PUBLISHED"}` là
   * EDITOR đăng thẳng dự án hợp tác lên trang chủ, bỏ qua trọn vẹn luồng duyệt.
   *
   * Trạng thái xuất bản do SERVER sở hữu: `create()` đặt mốc khởi tạo qua
   * `initialContentStatus(actorRole)`, còn mọi chuyển tiếp về sau đi qua đúng
   * một cửa là `PATCH /cooperation/:id/status`, nơi có kiểm vai trò.
   *
   * `status` (ngay bên trên) là chuyện khác hẳn: đó là trạng thái mô tả bằng
   * CHỮ của dự án ("Đang triển khai"), song ngữ, không liên quan ContentStatus.
   * Đừng gộp hai field này lại.
   *
   * `contentStatus` vẫn được **đọc** bình thường trong response — chốt này chỉ
   * đóng đường GHI qua API nội dung chung.
   */

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  order?: number;
}
