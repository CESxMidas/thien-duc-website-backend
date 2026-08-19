import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../generated/prisma/client';
import { UpdateContentStatusDto } from '../common/dto/update-content-status.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CooperationService } from './cooperation.service';
import { CreateCooperationProjectDto } from './dto/create-cooperation-project.dto';
import { ReorderCooperationProjectsDto } from './dto/reorder-cooperation-projects.dto';
import { UpdateCooperationProjectDto } from './dto/update-cooperation-project.dto';

@ApiTags('cooperation')
@Controller('cooperation')
export class CooperationController {
  constructor(private readonly cooperationService: CooperationService) {}

  @ApiOperation({
    summary: 'Danh sách dự án hợp tác đã xuất bản (website công khai).',
  })
  @Get()
  findAll() {
    return this.cooperationService.findAll(true);
  }

  // Các route tĩnh (`admin`, `reorder`) phải khai báo trước `:id`,
  // nếu không Nest sẽ khớp chúng vào tham số id.

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Danh sách đầy đủ cho Admin CMS — gồm cả nháp và chờ duyệt.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get('admin')
  findAllForAdmin() {
    return this.cooperationService.findAll(false);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get('admin/:id')
  findOne(@Param('id') id: string) {
    return this.cooperationService.findOne(id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sắp xếp lại thứ tự hiển thị dự án hợp tác.' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch('reorder')
  reorder(@Body() dto: ReorderCooperationProjectsDto) {
    return this.cooperationService.reorder(dto.cooperationProjectIds);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Tạo dự án hợp tác mới — luôn ở trạng thái nháp.',
    description:
      'Dự án mới KHÔNG bao giờ tự công khai, kể cả khi người tạo là SUPER_ADMIN. Việc đăng đi qua lệnh riêng `PATCH /cooperation/:id/status`. Payload không nhận `contentStatus`.',
  })
  @Post()
  create(@Body() dto: CreateCooperationProjectDto) {
    return this.cooperationService.create(dto);
  }

  /**
   * Sửa nội dung dự án hợp tác. Vai trò đã xác thực đi xuống service vì `@Roles`
   * không nhìn thấy `contentStatus` của bản ghi đang sửa (§7).
   */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Sửa nội dung dự án hợp tác.',
    description:
      'EDITOR chỉ sửa được dự án ở trạng thái nháp hoặc chờ duyệt; dự án đã xuất bản trả 403. ' +
      'ADMIN và SUPER_ADMIN sửa được ở mọi trạng thái. Payload không nhận `contentStatus`.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCooperationProjectDto,
    @CurrentUser() user: { role: string },
  ) {
    return this.cooperationService.update(id, dto, user.role);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Đổi trạng thái nội dung. EDITOR chỉ gửi duyệt (DRAFT → PENDING); ADMIN trở lên duyệt/đăng/gỡ.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateContentStatusDto,
    @CurrentUser() user: { role: string },
  ) {
    return this.cooperationService.updateStatus(id, dto.status, user.role);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.cooperationService.remove(id);
  }
}
