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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UpdateContentStatusDto } from '../common/dto/update-content-status.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreatePageDto } from './dto/create-page.dto';
import { SchedulePagePublicationDto } from './dto/schedule-page-publication.dto';
import { UpdatePageDto } from './dto/update-page.dto';
import { PagesSchedulerService } from './pages-scheduler.service';
import { PagesService } from './pages.service';

@ApiTags('pages')
@Controller('pages')
export class PagesController {
  constructor(
    private readonly pagesService: PagesService,
    private readonly pagesSchedulerService: PagesSchedulerService,
  ) {}

  // Route tĩnh (`admin`, `publish-scheduled`) phải đứng trước `:slug`, nếu
  // không Nest khớp chúng vào slug.

  /**
   * Kích hoạt thủ công lượt đăng trang theo lịch. Cron nội bộ chỉ chạy khi tiến
   * trình còn sống — Render free tier ngủ sau 15 phút không có request, nên cần
   * một cron ngoài (UptimeRobot, cron-job.org) gọi route này.
   *
   * Cron và route này gọi CÙNG một phương thức service — không có câu SQL thứ hai.
   */
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Đăng ngay các trang đã tới hạn `scheduledAt`.' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post('publish-scheduled')
  async publishScheduled() {
    const published = await this.pagesSchedulerService.publishDuePages();
    return { published: published.length, pages: published };
  }

  /** Danh sách cho Admin CMS: kèm cả trang nháp và trang chờ duyệt. */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get('admin')
  findAllForAdmin() {
    return this.pagesService.findAll(false);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get('admin/:slug')
  findOneForAdmin(@Param('slug') slug: string) {
    return this.pagesService.findBySlug(slug);
  }

  @ApiOperation({
    summary: 'Danh sách trang đã xuất bản (website công khai).',
    description:
      'Lọc theo luật hiển thị dùng chung: đã đăng, HOẶC đang chờ duyệt có lịch đã tới hạn. Trang hẹn giờ tương lai không xuất hiện.',
  })
  @Get()
  findAll() {
    return this.pagesService.findAll(true);
  }

  @ApiOperation({
    summary: 'Chi tiết trang đã xuất bản (website công khai).',
    description:
      'Trang chưa tới hạn lên lịch trả 404 giống hệt trang nháp — không lộ `scheduledAt`, không phân biệt "không tồn tại" với "sắp công khai".',
  })
  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.pagesService.findBySlug(slug, true);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Tạo trang mới — luôn ở trạng thái nháp.',
    description:
      'Trang mới KHÔNG bao giờ tự công khai, kể cả khi người tạo là SUPER_ADMIN. Việc đăng đi qua lệnh riêng `PATCH /pages/:slug/status`. Payload không nhận `status`.',
  })
  @Post()
  create(@Body() dto: CreatePageDto) {
    return this.pagesService.create(dto);
  }

  /**
   * Sửa nội dung trang. Vai trò đã xác thực đi xuống service vì `@Roles` không
   * nhìn thấy `status` của bản ghi đang sửa (§7).
   */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Sửa nội dung trang.',
    description:
      'EDITOR chỉ sửa được trang ở trạng thái nháp hoặc chờ duyệt; trang đã xuất bản trả 403. ' +
      'ADMIN và SUPER_ADMIN sửa được ở mọi trạng thái. Payload không nhận `status`.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':slug')
  update(
    @Param('slug') slug: string,
    @Body() dto: UpdatePageDto,
    @CurrentUser() user: { role: string },
  ) {
    return this.pagesService.update(slug, dto, user.role);
  }

  /**
   * Đặt / đổi lịch đăng. Route LỆNH riêng, không đi qua `PATCH :slug` — sửa nội
   * dung và uỷ quyền đăng trong tương lai là hai việc khác nhau, khác cả quyền.
   */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Đặt hoặc đổi lịch đăng trang. Chỉ ADMIN trở lên.',
    description:
      'Đặt lịch tương đương uỷ quyền cho một lần đăng trong tương lai nên chốt quyền y như "Đăng ngay". ' +
      'Ghi nguyên tử `status = PENDING`, `scheduledAt` và `publishedAt` cùng bằng mốc đã hẹn; KHÔNG chạm nội dung. ' +
      'Đây cũng là cách duyệt-bằng-lịch một trang do biên tập viên gửi lên. ' +
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
  @ApiResponse({ status: 404, description: 'Không tìm thấy trang.' })
  @ApiResponse({
    status: 409,
    description: 'Trang đang đăng công khai, hoặc đã từng được đăng.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':slug/schedule')
  schedulePublication(
    @Param('slug') slug: string,
    @Body() dto: SchedulePagePublicationDto,
  ) {
    return this.pagesService.schedulePublication(slug, dto.scheduledAt);
  }

  /**
   * Huỷ lịch đăng CHƯA tới hạn. Lịch đã qua giờ nghĩa là trang đang công khai
   * (vị từ hiển thị), gỡ nó xuống là việc của `PATCH :slug/status`.
   */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Huỷ lịch đăng trang chưa tới hạn. Chỉ ADMIN trở lên.',
    description:
      'Đưa trang về `DRAFT`, xoá `scheduledAt` và `publishedAt` (mốc chưa từng thành sự thật) — tức thu hồi luôn phê duyệt. ' +
      'Lịch ĐÃ qua giờ bị từ chối 409: khi đó trang đã hiển thị công khai, dùng "Trả về nháp" để gỡ xuống.',
  })
  @ApiResponse({ status: 200, description: 'Đã huỷ lịch, trang về nháp.' })
  @ApiResponse({ status: 403, description: 'EDITOR không được huỷ lịch.' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy trang.' })
  @ApiResponse({
    status: 409,
    description: 'Trang không có lịch, hoặc lịch đã qua giờ đăng.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Delete(':slug/schedule')
  cancelScheduledPublication(@Param('slug') slug: string) {
    return this.pagesService.cancelScheduledPublication(slug);
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
    return this.pagesService.updateStatus(slug, dto.status, user.role);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Delete(':slug')
  remove(@Param('slug') slug: string) {
    return this.pagesService.remove(slug);
  }
}
