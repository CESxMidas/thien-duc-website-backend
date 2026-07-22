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
import { CreateGalleryImageDto } from './dto/create-gallery-image.dto';
import { CreateProjectItemDto } from './dto/create-project-item.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { ReorderGalleryDto } from './dto/reorder-gallery.dto';
import { UpdateGalleryImageDto } from './dto/update-gallery-image.dto';
import { UpdateProjectItemDto } from './dto/update-project-item.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @ApiOperation({ summary: 'Danh sách dự án đã xuất bản (website công khai).' })
  @Get()
  findAll() {
    return this.projectsService.findAll(true);
  }

  // Phải đứng trước `@Get(':slug')`, nếu không "admin" bị bắt làm slug dự án.
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Danh sách đầy đủ cho Admin CMS — gồm cả nháp và chờ duyệt.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get('admin')
  findAllForAdmin() {
    return this.projectsService.findAll(false);
  }

  // `admin/:slug` phải đứng trước `:slug/:itemSlug`, nếu không "admin" bị khớp
  // vào slug dự án và phần còn lại thành slug hạng mục.

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Chi tiết dự án cho Admin CMS — gồm cả nháp.' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get('admin/:slug')
  findOneForAdmin(@Param('slug') slug: string) {
    return this.projectsService.findBySlug(slug);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Thư viện ảnh dự án cho Admin CMS — gồm cả nháp.' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get('admin/:slug/gallery')
  findGalleryForAdmin(@Param('slug') slug: string) {
    return this.projectsService.findGallery(slug);
  }

  // Ba route dưới đây công khai → luôn truyền `publishedOnly = true`.

  @ApiOperation({ summary: 'Chi tiết một dự án đã xuất bản.' })
  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.projectsService.findBySlug(slug, true);
  }

  @ApiOperation({
    summary: 'Thư viện ảnh của dự án, xếp theo thứ tự hiển thị.',
  })
  @Get(':slug/gallery')
  findGallery(@Param('slug') slug: string) {
    return this.projectsService.findGallery(slug, true);
  }

  @ApiOperation({ summary: 'Chi tiết hạng mục thuộc dự án đã xuất bản.' })
  @Get(':slug/:itemSlug')
  findItem(@Param('slug') slug: string, @Param('itemSlug') itemSlug: string) {
    return this.projectsService.findItemBySlug(slug, itemSlug, true);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: { role: string }) {
    return this.projectsService.create(dto, user.role);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':slug')
  update(@Param('slug') slug: string, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(slug, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Đổi trạng thái nội dung. EDITOR chỉ gửi duyệt (DRAFT → PENDING); ADMIN trở lên duyệt/đăng/gỡ.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':slug/status')
  updateStatus(
    @Param('slug') slug: string,
    @Body() dto: UpdateContentStatusDto,
    @CurrentUser() user: { role: string },
  ) {
    return this.projectsService.updateStatus(slug, dto.status, user.role);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Delete(':slug')
  remove(@Param('slug') slug: string) {
    return this.projectsService.remove(slug);
  }

  /* ----------------------------- Hạng mục con ----------------------------- */

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Post(':slug/items')
  createItem(@Param('slug') slug: string, @Body() dto: CreateProjectItemDto) {
    return this.projectsService.createItem(slug, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':slug/items/:itemSlug')
  updateItem(
    @Param('slug') slug: string,
    @Param('itemSlug') itemSlug: string,
    @Body() dto: UpdateProjectItemDto,
  ) {
    return this.projectsService.updateItem(slug, itemSlug, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Delete(':slug/items/:itemSlug')
  removeItem(@Param('slug') slug: string, @Param('itemSlug') itemSlug: string) {
    return this.projectsService.removeItem(slug, itemSlug);
  }

  /* ------------------------------- Thư viện ảnh ---------------------------- */

  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Thêm ảnh vào thư viện. Truyền `itemSlug` để gắn ảnh vào một hạng mục con.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Post(':slug/gallery')
  addGalleryImage(
    @Param('slug') slug: string,
    @Body() dto: CreateGalleryImageDto,
  ) {
    return this.projectsService.addGalleryImage(slug, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sắp xếp lại toàn bộ thư viện ảnh của dự án.' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':slug/gallery/reorder')
  reorderGallery(@Param('slug') slug: string, @Body() dto: ReorderGalleryDto) {
    return this.projectsService.reorderGallery(slug, dto.imageIds);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':slug/gallery/:imageId')
  updateGalleryImage(
    @Param('slug') slug: string,
    @Param('imageId') imageId: string,
    @Body() dto: UpdateGalleryImageDto,
  ) {
    return this.projectsService.updateGalleryImage(slug, imageId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Delete(':slug/gallery/:imageId')
  removeGalleryImage(
    @Param('slug') slug: string,
    @Param('imageId') imageId: string,
  ) {
    return this.projectsService.removeGalleryImage(slug, imageId);
  }
}
