import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateDeletePermissionsDto {
  @ApiProperty({ description: 'Quyền xóa chung toàn CMS; false để thu hồi.' })
  @IsBoolean()
  canDeleteCms!: boolean;
}
