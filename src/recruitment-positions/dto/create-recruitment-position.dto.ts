import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ContentStatus } from '../../../generated/prisma/client';
import { TranslatedTextDto } from '../../common/dto/translated-text.dto';
import {
  MAX_RECRUITMENT_LIST_ITEMS,
  TranslatedTextListDto,
} from './translated-text-list.dto';

export type RecruitmentPositionStatus = 'DRAFT' | 'PENDING' | 'PUBLISHED';

const RECRUITMENT_POSITION_STATUSES: RecruitmentPositionStatus[] = [
  ContentStatus.DRAFT,
  ContentStatus.PENDING,
  ContentStatus.PUBLISHED,
];

export class CreateRecruitmentPositionDto {
  @ApiProperty({ maxLength: 160, example: 'ky-su-xay-dung' })
  @IsString()
  @MaxLength(160)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @ApiProperty({ type: TranslatedTextDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  title!: TranslatedTextDto;

  @ApiProperty({ type: TranslatedTextDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  department!: TranslatedTextDto;

  @ApiProperty({ type: TranslatedTextDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  location!: TranslatedTextDto;

  @ApiProperty({
    type: TranslatedTextDto,
    description: 'Hình thức làm việc, ví dụ toàn thời gian hoặc bán thời gian.',
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  type!: TranslatedTextDto;

  @ApiProperty({ type: TranslatedTextDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextDto)
  summary!: TranslatedTextDto;

  @ApiProperty({
    type: TranslatedTextListDto,
    description: `Danh sách nhiệm vụ (tối đa ${MAX_RECRUITMENT_LIST_ITEMS} mục mỗi ngôn ngữ).`,
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextListDto)
  responsibilities!: TranslatedTextListDto;

  @ApiProperty({
    type: TranslatedTextListDto,
    description: `Danh sách yêu cầu (tối đa ${MAX_RECRUITMENT_LIST_ITEMS} mục mỗi ngôn ngữ).`,
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextListDto)
  requirements!: TranslatedTextListDto;

  @ApiProperty({
    type: TranslatedTextListDto,
    description: `Danh sách quyền lợi (tối đa ${MAX_RECRUITMENT_LIST_ITEMS} mục mỗi ngôn ngữ).`,
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => TranslatedTextListDto)
  benefits!: TranslatedTextListDto;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-12-31',
    description:
      'Hạn ứng tuyển theo ngày Việt Nam, định dạng YYYY-MM-DD; null nếu không có hạn.',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  deadline?: string | null;

  @ApiPropertyOptional({
    enum: RECRUITMENT_POSITION_STATUSES,
    default: ContentStatus.DRAFT,
  })
  @IsOptional()
  @IsIn(RECRUITMENT_POSITION_STATUSES)
  status?: RecruitmentPositionStatus;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
