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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UpdateContentStatusDto } from '../common/dto/update-content-status.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateNewsCategoryDto } from './dto/create-news-category.dto';
import { CreateNewsPostDto } from './dto/create-news-post.dto';
import { UpdateNewsCategoryDto } from './dto/update-news-category.dto';
import { UpdateNewsPostDto } from './dto/update-news-post.dto';
import { NewsSchedulerService } from './news-scheduler.service';
import { NewsService } from './news.service';

@ApiTags('news')
@Controller('news')
export class NewsController {
  constructor(
    private readonly newsService: NewsService,
    private readonly newsSchedulerService: NewsSchedulerService,
  ) {}

  // Các route tĩnh (`categories`, `admin`) phải khai báo trước `:slug`,
  // nếu không Nest sẽ khớp chúng vào tham số slug.

  @Get('categories')
  findAllCategories() {
    return this.newsService.findAllCategories();
  }

  /**
   * Kích hoạt thủ công lượt đăng theo lịch. Cron nội bộ chỉ chạy khi tiến trình
   * còn sống — Render free tier ngủ sau 15 phút không có request, nên cần một
   * cron ngoài (UptimeRobot, cron-job.org) gọi route này để bài đúng hạn vẫn lên.
   */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Đăng ngay các bài đã tới hạn `scheduledAt` (ED-08).',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post('publish-scheduled')
  async publishScheduled() {
    const published = await this.newsSchedulerService.publishDuePosts();
    return { published: published.length, posts: published };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Post('categories')
  createCategory(@Body() dto: CreateNewsCategoryDto) {
    return this.newsService.createCategory(dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch('categories/:slug')
  updateCategory(
    @Param('slug') slug: string,
    @Body() dto: UpdateNewsCategoryDto,
  ) {
    return this.newsService.updateCategory(slug, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Delete('categories/:slug')
  removeCategory(@Param('slug') slug: string) {
    return this.newsService.removeCategory(slug);
  }

  /** Danh sách cho Admin CMS: kèm cả bài nháp và bài chờ duyệt. */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get('admin')
  findAllForAdmin() {
    return this.newsService.findAll(false);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get('admin/:slug')
  findOneForAdmin(@Param('slug') slug: string) {
    return this.newsService.findBySlug(slug);
  }

  @Get()
  findAll() {
    return this.newsService.findAll(true);
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.newsService.findBySlug(slug, true);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Post()
  create(
    @Body() dto: CreateNewsPostDto,
    @CurrentUser() user: { role: string },
  ) {
    return this.newsService.create(dto, user.role);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':slug')
  update(@Param('slug') slug: string, @Body() dto: UpdateNewsPostDto) {
    return this.newsService.update(slug, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':slug/status')
  updateStatus(
    @Param('slug') slug: string,
    @Body() dto: UpdateContentStatusDto,
  ) {
    return this.newsService.updateStatus(slug, dto.status);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Delete(':slug')
  remove(@Param('slug') slug: string) {
    return this.newsService.remove(slug);
  }
}
