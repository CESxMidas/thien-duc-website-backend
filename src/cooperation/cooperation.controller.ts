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
  @Post()
  create(
    @Body() dto: CreateCooperationProjectDto,
    @CurrentUser() user: { role: string },
  ) {
    return this.cooperationService.create(dto, user.role);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCooperationProjectDto) {
    return this.cooperationService.update(id, dto);
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
