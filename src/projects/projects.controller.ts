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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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
import { ScheduleProjectPublicationDto } from './dto/schedule-project-publication.dto';
import { UpdateGalleryImageDto } from './dto/update-gallery-image.dto';
import { UpdateProjectItemDto } from './dto/update-project-item.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsSchedulerService } from './projects-scheduler.service';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectsSchedulerService: ProjectsSchedulerService,
  ) {}

  /**
   * Kích hoạt thủ công lượt đăng dự án theo lịch. Cron nội bộ chỉ chạy khi tiến
   * trình còn sống — Render free tier ngủ sau 15 phút không có request, nên cần
   * một cron ngoài (UptimeRobot, cron-job.org) gọi route này.
   *
   * Route riêng cho dự án, song song với `POST /news/publish-scheduled`: gộp hai
   * bảng vào một endpoint "đồng bộ tất cả" nghe gọn hơn nhưng làm mất khả năng
   * chạy/giám sát riêng từng loại nội dung, và biến một lỗi ở một bảng thành lỗi
   * của cả lượt.
   *
   * Cron và route này gọi CÙNG một phương thức service — không có câu SQL thứ hai.
   */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Đăng ngay các dự án đã tới hạn `scheduledAt`.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post('publish-scheduled')
  async publishScheduled() {
    const published = await this.projectsSchedulerService.publishDueProjects();
    return { published: published.length, projects: published };
  }

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
  @ApiOperation({
    summary: 'Tạo dự án mới — luôn ở trạng thái nháp.',
    description:
      'Dự án mới KHÔNG bao giờ tự công khai, kể cả khi người tạo là SUPER_ADMIN. Việc đăng đi qua lệnh riêng `PATCH /projects/:slug/status`. Payload không nhận `contentStatus`.',
  })
  @Post()
  create(@Body() dto: CreateProjectDto) {
    return this.projectsService.create(dto);
  }

  /**
   * Sửa nội dung dự án. Vai trò đã xác thực đi xuống service vì `@Roles` không
   * nhìn thấy `contentStatus` của bản ghi đang sửa (§7).
   */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Sửa nội dung dự án.',
    description:
      'EDITOR chỉ sửa được dự án ở trạng thái nháp hoặc chờ duyệt; dự án đã xuất bản trả 403. ' +
      'ADMIN và SUPER_ADMIN sửa được ở mọi trạng thái. Payload không nhận `contentStatus`.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':slug')
  update(
    @Param('slug') slug: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: { role: string },
  ) {
    return this.projectsService.update(slug, dto, user.role);
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

  /**
   * Đặt / đổi lịch đăng. Route LỆNH riêng, không đi qua `PATCH :slug` — sửa nội
   * dung và uỷ quyền đăng trong tương lai là hai việc khác nhau, khác cả quyền.
   */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Đặt hoặc đổi lịch đăng dự án. Chỉ ADMIN trở lên.',
    description:
      'Đặt lịch tương đương uỷ quyền cho một lần đăng trong tương lai nên chốt quyền y như "Đăng ngay". ' +
      'Ghi nguyên tử `contentStatus = PENDING`, `scheduledAt` và `publishedAt` cùng bằng mốc đã hẹn. ' +
      'Chỉ dành cho lần công khai ĐẦU TIÊN. `scheduledAt` bắt buộc kèm múi giờ tường minh (`Z` hoặc `±HH:MM`), ' +
      'cách hiện tại tối thiểu 1 phút và tối đa 2 năm.',
  })
  @ApiResponse({ status: 200, description: 'Đã đặt lịch.' })
  @ApiResponse({
    status: 400,
    description:
      'Mốc thời gian sai định dạng, thiếu múi giờ, quá gần (<1 phút) hoặc quá xa (>2 năm).',
  })
  @ApiResponse({ status: 403, description: 'EDITOR không được đặt lịch.' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy dự án.' })
  @ApiResponse({
    status: 409,
    description: 'Dự án đang đăng công khai, hoặc đã từng được đăng.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':slug/schedule')
  schedulePublication(
    @Param('slug') slug: string,
    @Body() dto: ScheduleProjectPublicationDto,
  ) {
    return this.projectsService.schedulePublication(slug, dto.scheduledAt);
  }

  /**
   * Huỷ lịch đăng CHƯA tới hạn. Lịch đã qua giờ nghĩa là dự án đang công khai
   * (vị từ hiển thị), gỡ nó xuống là việc của `PATCH :slug/status`.
   */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Huỷ lịch đăng dự án chưa tới hạn. Chỉ ADMIN trở lên.',
    description:
      'Đưa dự án về `DRAFT`, xoá `scheduledAt` và `publishedAt` (mốc chưa từng thành sự thật). ' +
      'Lịch ĐÃ qua giờ bị từ chối 409: khi đó dự án đã hiển thị công khai, dùng "Trả về nháp" để gỡ xuống.',
  })
  @ApiResponse({ status: 200, description: 'Đã huỷ lịch, dự án về nháp.' })
  @ApiResponse({ status: 403, description: 'EDITOR không được huỷ lịch.' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy dự án.' })
  @ApiResponse({
    status: 409,
    description: 'Dự án không có lịch, hoặc lịch đã qua giờ đăng.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Delete(':slug/schedule')
  cancelScheduledPublication(@Param('slug') slug: string) {
    return this.projectsService.cancelScheduledPublication(slug);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Delete(':slug')
  remove(@Param('slug') slug: string) {
    return this.projectsService.remove(slug);
  }

  /* ----------------------------- Hạng mục con ----------------------------- */

  // Hạng mục và ảnh thư viện KHÔNG có trạng thái xuất bản riêng — chúng hiển thị
  // công khai vì dự án cha hiển thị công khai. Nên mọi lệnh ghi bên dưới đều
  // truyền vai trò đã xác thực xuống service để chốt theo `contentStatus` của
  // CHA: chặn `PATCH /projects/:slug` mà bỏ ngỏ nhóm route này thì EDITOR vẫn
  // đổi được nội dung đang chạy trên website qua đường vòng.

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Thêm hạng mục vào dự án.',
    description:
      'EDITOR chỉ thêm được khi dự án cha ở trạng thái nháp hoặc chờ duyệt; dự án đã xuất bản trả 403. ADMIN trở lên không đổi.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Post(':slug/items')
  createItem(
    @Param('slug') slug: string,
    @Body() dto: CreateProjectItemDto,
    @CurrentUser() user: { role: string },
  ) {
    return this.projectsService.createItem(slug, dto, user.role);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Sửa hạng mục dự án.',
    description:
      'EDITOR chỉ sửa được khi dự án cha ở trạng thái nháp hoặc chờ duyệt; dự án đã xuất bản trả 403. ADMIN trở lên không đổi.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':slug/items/:itemSlug')
  updateItem(
    @Param('slug') slug: string,
    @Param('itemSlug') itemSlug: string,
    @Body() dto: UpdateProjectItemDto,
    @CurrentUser() user: { role: string },
  ) {
    return this.projectsService.updateItem(slug, itemSlug, dto, user.role);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Delete(':slug/items/:itemSlug')
  removeItem(
    @Param('slug') slug: string,
    @Param('itemSlug') itemSlug: string,
    @CurrentUser() user: { role: string },
  ) {
    return this.projectsService.removeItem(slug, itemSlug, user.role);
  }

  /* ------------------------------- Thư viện ảnh ---------------------------- */

  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Thêm ảnh vào thư viện. Truyền `itemSlug` để gắn ảnh vào một hạng mục con.',
    description:
      'EDITOR chỉ thêm được khi dự án cha ở trạng thái nháp hoặc chờ duyệt; dự án đã xuất bản trả 403. ADMIN trở lên không đổi.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Post(':slug/gallery')
  addGalleryImage(
    @Param('slug') slug: string,
    @Body() dto: CreateGalleryImageDto,
    @CurrentUser() user: { role: string },
  ) {
    return this.projectsService.addGalleryImage(slug, dto, user.role);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Sắp xếp lại toàn bộ thư viện ảnh của dự án.',
    description:
      'Thứ tự ảnh là nội dung công khai (ảnh đầu tiên là ảnh người xem thấy trước), nên EDITOR chỉ sắp xếp được khi dự án cha chưa xuất bản.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':slug/gallery/reorder')
  reorderGallery(
    @Param('slug') slug: string,
    @Body() dto: ReorderGalleryDto,
    @CurrentUser() user: { role: string },
  ) {
    return this.projectsService.reorderGallery(slug, dto.imageIds, user.role);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Sửa một ảnh trong thư viện (mô tả, thứ tự, hạng mục gắn kèm).',
    description:
      'EDITOR chỉ sửa được khi dự án cha ở trạng thái nháp hoặc chờ duyệt; dự án đã xuất bản trả 403.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':slug/gallery/:imageId')
  updateGalleryImage(
    @Param('slug') slug: string,
    @Param('imageId') imageId: string,
    @Body() dto: UpdateGalleryImageDto,
    @CurrentUser() user: { role: string },
  ) {
    return this.projectsService.updateGalleryImage(
      slug,
      imageId,
      dto,
      user.role,
    );
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xóa một ảnh khỏi thư viện dự án.',
    description:
      'EDITOR chỉ xóa được khi dự án cha ở trạng thái nháp hoặc chờ duyệt; dự án đã xuất bản trả 403.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Delete(':slug/gallery/:imageId')
  removeGalleryImage(
    @Param('slug') slug: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: { role: string },
  ) {
    return this.projectsService.removeGalleryImage(slug, imageId, user.role);
  }
}
