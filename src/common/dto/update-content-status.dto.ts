import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ContentStatus } from '../../../generated/prisma/client';

export class UpdateContentStatusDto {
  @ApiProperty({
    enum: ContentStatus,
    description:
      'Trạng thái xuất bản mục nội dung: nháp, chờ duyệt hoặc đã đăng.',
  })
  @IsEnum(ContentStatus)
  status!: ContentStatus;
}
