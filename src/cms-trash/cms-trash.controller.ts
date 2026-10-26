import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CmsRecordKind } from './cms-records';
import { CmsTrashService } from './cms-trash.service';
import { PurgeRecordDto } from './purge-record.dto';

@ApiTags('cms-trash')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cms-trash')
export class CmsTrashController {
  constructor(private readonly service: CmsTrashService) {}

  @Delete(':kind/:id/permanent')
  @ApiOperation({ summary: 'Xóa vĩnh viễn nội dung, yêu cầu xác nhận rõ ràng' })
  @ApiResponse({
    status: 200,
    description: 'Đã xóa bản ghi; không thể khôi phục.',
  })
  purge(
    @Param('kind', new ParseEnumPipe(CmsRecordKind)) kind: CmsRecordKind,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PurgeRecordDto,
    @CurrentUser() user: { id: string },
  ) {
    if (dto.confirm !== true)
      throw new BadRequestException('Cần xác nhận xóa vĩnh viễn.');
    return this.service.purge(kind, id, user.id);
  }

  @Get(':kind')
  @ApiOperation({ summary: 'Danh sách thùng rác theo mục được cấp quyền' })
  @ApiResponse({
    status: 200,
    description:
      'Danh sách phân trang, không trả nội dung nhạy cảm của tài khoản.',
  })
  list(
    @Param('kind', new ParseEnumPipe(CmsRecordKind)) kind: CmsRecordKind,
    @CurrentUser() user: { id: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ) {
    return this.service.list(kind, user.id, page);
  }

  @Delete(':kind/:id')
  @ApiOperation({
    summary: 'Chuyển nội dung vào thùng rác; kiểm tra quyền từ DB',
  })
  @ApiResponse({
    status: 200,
    description: 'Đã chuyển vào thùng rác, có thể khôi phục.',
  })
  trash(
    @Param('kind', new ParseEnumPipe(CmsRecordKind)) kind: CmsRecordKind,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.trash(kind, id, user.id);
  }

  @Post(':kind/:id/restore')
  @ApiOperation({
    summary: 'Khôi phục nội dung; không tự đăng lại hoặc kích hoạt tài khoản',
  })
  @ApiResponse({
    status: 200,
    description: 'Đã khôi phục; nội dung xuất bản cần được duyệt/đăng lại.',
  })
  restore(
    @Param('kind', new ParseEnumPipe(CmsRecordKind)) kind: CmsRecordKind,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.restore(kind, id, user.id);
  }
}
