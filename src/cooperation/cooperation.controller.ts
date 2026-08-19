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
import { CooperationSchedulerService } from './cooperation-scheduler.service';
import { CooperationService } from './cooperation.service';
import { CreateCooperationProjectDto } from './dto/create-cooperation-project.dto';
import { ReorderCooperationProjectsDto } from './dto/reorder-cooperation-projects.dto';
import { ScheduleCooperationPublicationDto } from './dto/schedule-cooperation-publication.dto';
import { UpdateCooperationProjectDto } from './dto/update-cooperation-project.dto';

@ApiTags('cooperation')
@Controller('cooperation')
export class CooperationController {
  constructor(
    private readonly cooperationService: CooperationService,
    private readonly cooperationSchedulerService: CooperationSchedulerService,
  ) {}

  /**
   * Kích hoạt thủ công lượt đăng dự án hợp tác theo lịch. Cron nội bộ chỉ chạy
   * khi tiến trình còn sống — Render free tier ngủ sau 15 phút không có request,
   * nên cần một cron ngoài (UptimeRobot, cron-job.org) gọi route này.
   *
   * Route riêng cho dự án hợp tác, song song với `POST /news/publish-scheduled`
   * và `POST /projects/publish-scheduled`: gộp các bảng vào một endpoint "đồng
   * bộ tất cả" nghe gọn hơn nhưng làm mất khả năng chạy/giám sát riêng từng loại
   * nội dung, và biến một lỗi ở một bảng thành lỗi của cả lượt.
   *
   * Cron và route này gọi CÙNG một phương thức service — không có câu SQL thứ hai.
   */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Đăng ngay các dự án hợp tác đã tới hạn `scheduledAt`.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post('publish-scheduled')
  async publishScheduled() {
    const published =
      await this.cooperationSchedulerService.publishDueProjects();
    return { published: published.length, cooperationProjects: published };
  }

  @ApiOperation({
    summary: 'Danh sách dự án hợp tác đã xuất bản (website công khai).',
    description:
      'Lọc theo luật hiển thị dùng chung: đã đăng, HOẶC đang chờ duyệt có lịch đã tới hạn. Bản hẹn giờ tương lai không xuất hiện.',
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
  @ApiOperation({
    summary: 'Sắp xếp lại thứ tự hiển thị dự án hợp tác.',
    description:
      '`order` là thứ tự các thẻ chạy ở trang chủ, nên đây là thay đổi nội dung công khai. ' +
      'Biên tập viên chỉ sắp xếp được khi MỌI dự án hợp tác còn trong khâu biên tập ' +
      '(nháp chưa từng đăng, hoặc chờ duyệt chưa hẹn giờ); có bất kỳ bản nào đã đăng/đã lên lịch → 403, không ghi gì.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch('reorder')
  reorder(
    @Body() dto: ReorderCooperationProjectsDto,
    @CurrentUser() user: { role: string },
  ) {
    return this.cooperationService.reorder(
      dto.cooperationProjectIds,
      user.role,
    );
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

  /**
   * Đặt / đổi lịch đăng. Route LỆNH riêng, không đi qua `PATCH :id` — sửa nội
   * dung và uỷ quyền đăng trong tương lai là hai việc khác nhau, khác cả quyền.
   */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Đặt hoặc đổi lịch đăng dự án hợp tác. Chỉ ADMIN trở lên.',
    description:
      'Đặt lịch tương đương uỷ quyền cho một lần đăng trong tương lai nên chốt quyền y như "Đăng ngay". ' +
      'Ghi nguyên tử `contentStatus = PENDING`, `scheduledAt` và `publishedAt` cùng bằng mốc đã hẹn; ' +
      'KHÔNG đụng tới `status` (trạng thái mô tả bằng chữ). Đây cũng là cách duyệt-bằng-lịch một bản do biên tập viên gửi lên. ' +
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
  @ApiResponse({ status: 404, description: 'Không tìm thấy dự án hợp tác.' })
  @ApiResponse({
    status: 409,
    description: 'Dự án hợp tác đang đăng công khai, hoặc đã từng được đăng.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':id/schedule')
  schedulePublication(
    @Param('id') id: string,
    @Body() dto: ScheduleCooperationPublicationDto,
  ) {
    return this.cooperationService.schedulePublication(id, dto.scheduledAt);
  }

  /**
   * Huỷ lịch đăng CHƯA tới hạn. Lịch đã qua giờ nghĩa là dự án hợp tác đang
   * công khai (vị từ hiển thị), gỡ nó xuống là việc của `PATCH :id/status`.
   */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Huỷ lịch đăng dự án hợp tác chưa tới hạn. Chỉ ADMIN trở lên.',
    description:
      'Đưa về `DRAFT`, xoá `scheduledAt` và `publishedAt` (mốc chưa từng thành sự thật) — tức thu hồi luôn phê duyệt. ' +
      'Lịch ĐÃ qua giờ bị từ chối 409: khi đó dự án hợp tác đã hiển thị công khai, dùng "Trả về nháp" để gỡ xuống.',
  })
  @ApiResponse({ status: 200, description: 'Đã huỷ lịch, dự án về nháp.' })
  @ApiResponse({ status: 403, description: 'EDITOR không được huỷ lịch.' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy dự án hợp tác.' })
  @ApiResponse({
    status: 409,
    description: 'Dự án hợp tác không có lịch, hoặc lịch đã qua giờ đăng.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Delete(':id/schedule')
  cancelScheduledPublication(@Param('id') id: string) {
    return this.cooperationService.cancelScheduledPublication(id);
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
