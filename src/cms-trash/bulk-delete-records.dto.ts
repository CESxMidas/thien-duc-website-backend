import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';

export enum BulkDeleteMode {
  TRASH = 'trash',
  PERMANENT = 'permanent',
}

export class BulkDeleteRecordsDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: 100,
    description: 'ID các bản ghi được chọn, không trùng nhau.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids!: string[];

  @ApiProperty({ enum: BulkDeleteMode })
  @IsEnum(BulkDeleteMode)
  mode!: BulkDeleteMode;

  @ApiPropertyOptional({
    example: true,
    description: 'Bắt buộc bằng true khi xóa vĩnh viễn.',
  })
  @IsOptional()
  @IsBoolean()
  @Equals(true)
  confirm?: boolean;
}
