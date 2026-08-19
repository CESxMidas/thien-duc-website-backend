import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { Role } from '../../generated/prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UpdateContentStatusDto } from '../common/dto/update-content-status.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateNewsCategoryDto } from './dto/create-news-category.dto';
import { CreateNewsPostDto } from './dto/create-news-post.dto';
import { NEWS_DEFAULT_PAGE_SIZE, QueryNewsDto } from './dto/query-news.dto';
import { ScheduleNewsPublicationDto } from './dto/schedule-news-publication.dto';
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

  /**
   * Danh sách chuyên mục CÔNG KHAI — website dùng để dựng chip lọc.
   *
   * Cố ý **không** trả `totalCount`: route này không cần đăng nhập, và số bài
   * nháp/chờ duyệt là thông tin nội bộ. Website chỉ cần biết chuyên mục có bài
   * đã đăng hay không (để ẩn chuyên mục rỗng khỏi chip) — đúng bằng
   * `publishedCount`.
   */
  @ApiOperation({
    summary: 'Chuyên mục tin (công khai). Chỉ kèm số bài ĐÃ ĐĂNG.',
    description:
      'Không trả tổng số bài: đây là route không cần đăng nhập, số bài chưa xuất bản là thông tin nội bộ.',
  })
  @ApiResponse({ status: 200, description: 'Sắp theo `order` rồi `slug`.' })
  @Get('categories')
  findAllCategories() {
    return this.newsService.findAllCategories();
  }

  /**
   * Danh sách chuyên mục cho Admin CMS — kèm **cả** `publishedCount` lẫn
   * `totalCount`. Admin cần `totalCount` để biết chuyên mục có xóa được không;
   * không được bắt Admin tự suy con số đó từ route công khai.
   */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Chuyên mục tin cho Admin — kèm publishedCount + totalCount.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get('categories/admin')
  findAllCategoriesForAdmin() {
    return this.newsService.findAllCategories(true);
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
  @ApiOperation({ summary: 'Tạo chuyên mục tin.' })
  @ApiResponse({ status: 201, description: 'Đã tạo.' })
  @ApiResponse({
    status: 400,
    description:
      'Slug sai định dạng (chữ thường, số, gạch ngang đơn, 3–160 ký tự).',
  })
  @ApiResponse({ status: 409, description: 'Slug đã tồn tại.' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Post('categories')
  createCategory(@Body() dto: CreateNewsCategoryDto) {
    return this.newsService.createCategory(dto);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Sửa tên song ngữ / thứ tự chuyên mục.',
    description:
      'KHÔNG sửa được `slug` — slug là URL công khai đã lập chỉ mục nên bị khoá sau khi tạo. Gửi kèm `slug` sẽ bị từ chối 400.',
  })
  @ApiResponse({ status: 404, description: 'Không tìm thấy chuyên mục.' })
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
  @ApiOperation({
    summary: 'Xóa chuyên mục — chỉ khi KHÔNG còn bài viết nào.',
    description:
      'Chuyên mục còn bài (mọi trạng thái) trả 409 với `code = CATEGORY_IN_USE` và `details.totalCount`. Không dùng `SetNull` để gỡ nhãn hàng loạt.',
  })
  @ApiResponse({
    status: 409,
    description: 'Chuyên mục đang được bài viết sử dụng.',
  })
  @ApiResponse({ status: 404, description: 'Không tìm thấy chuyên mục.' })
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

  /**
   * Danh sách công khai (chỉ bài PUBLISHED).
   *
   * Tương thích ngược có chủ đích: **không** truyền `page`/`limit` thì trả mảng
   * phẳng như trước, nên trang chủ, sitemap và mọi consumer cũ không phải sửa.
   * Có `page` hoặc `limit` thì trả envelope phân trang.
   */
  @ApiOperation({
    summary:
      'Bài đã đăng. Có `page`/`limit` → envelope phân trang; không có → mảng phẳng (giữ tương thích).',
    description:
      'Thêm `categorySlug` để lọc theo chuyên mục. Slug hợp lệ nhưng không có bài nào trả về trang rỗng, không phải lỗi.',
  })
  @Get()
  findAll(@Query() query: QueryNewsDto) {
    // `categorySlug` một mình KHÔNG bật nhánh phân trang: nhánh mảng phẳng là
    // hợp đồng tương thích ngược cho sitemap và `generateStaticParams`, đổi
    // hình dạng response ở đó sẽ phá các consumer đang chạy. Lọc chuyên mục là
    // tính năng của danh sách có phân trang.
    if (query.page === undefined && query.limit === undefined) {
      return this.newsService.findAll(true);
    }
    return this.newsService.findAllPaginated(
      query.page ?? 1,
      query.limit ?? NEWS_DEFAULT_PAGE_SIZE,
      query.categorySlug,
    );
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.newsService.findBySlug(slug, true);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Tạo bài viết mới — luôn ở trạng thái nháp.',
    description:
      'Bài mới KHÔNG bao giờ tự công khai, kể cả khi người tạo là SUPER_ADMIN. Việc đăng đi qua lệnh riêng: `PATCH /news/:slug/status` (đăng ngay / gửi duyệt) hoặc `PATCH /news/:slug/schedule` (hẹn giờ). Payload không nhận `status` lẫn `scheduledAt`.',
  })
  @Post()
  create(@Body() dto: CreateNewsPostDto) {
    return this.newsService.create(dto);
  }

  /**
   * Sửa nội dung bài viết.
   *
   * `@Roles` chỉ nói được "vai trò nào gọi được route"; nó KHÔNG nhìn thấy trạng
   * thái xuất bản của chính bài đang sửa. Vai trò đã xác thực vì thế phải đi
   * xuống service, nơi có bản ghi hiện tại để chốt quyền (§7: chặn ở backend,
   * không chỉ ẩn nút trong Admin CMS).
   */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Sửa nội dung bài viết.',
    description:
      'EDITOR chỉ sửa được bài còn trong khâu biên tập: nháp chưa từng công khai, hoặc bài chờ duyệt chưa được hẹn giờ. ' +
      'Bài đã lên lịch / đã tới hạn / đã đăng / nháp từng đăng trả 403 — bản mà quản trị viên đã duyệt phải là bản ra công khai. ' +
      'ADMIN và SUPER_ADMIN sửa được ở mọi trạng thái.',
  })
  @ApiResponse({
    status: 403,
    description: 'EDITOR sửa nội dung đã qua ranh giới duyệt/xuất bản.',
  })
  @ApiResponse({ status: 404, description: 'Không tìm thấy bài viết.' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':slug')
  update(
    @Param('slug') slug: string,
    @Body() dto: UpdateNewsPostDto,
    @CurrentUser() user: { role: string },
  ) {
    return this.newsService.update(slug, dto, user.role);
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
    return this.newsService.updateStatus(slug, dto.status, user.role);
  }

  /**
   * Đặt / đổi lịch đăng. Route LỆNH riêng, không đi qua `PATCH :slug` — sửa nội
   * dung và uỷ quyền đăng trong tương lai là hai việc khác nhau, khác cả quyền.
   */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Đặt hoặc đổi lịch đăng bài. Chỉ ADMIN trở lên.',
    description:
      'Đặt lịch tương đương uỷ quyền cho một lần đăng trong tương lai nên chốt quyền y như "Đăng ngay". ' +
      'Ghi nguyên tử `status = PENDING`, `scheduledAt` và `publishedAt` cùng bằng mốc đã hẹn. ' +
      '`scheduledAt` bắt buộc kèm múi giờ tường minh (`Z` hoặc `±HH:MM`), cách hiện tại tối thiểu 1 phút và tối đa 2 năm.',
  })
  @ApiResponse({ status: 200, description: 'Đã đặt lịch.' })
  @ApiResponse({
    status: 400,
    description:
      'Mốc thời gian sai định dạng, thiếu múi giờ, quá gần (<1 phút) hoặc quá xa (>2 năm).',
  })
  @ApiResponse({ status: 403, description: 'EDITOR không được đặt lịch.' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy bài viết.' })
  @ApiResponse({
    status: 409,
    description: 'Bài đang đăng công khai — phải trả về nháp trước.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':slug/schedule')
  schedulePublication(
    @Param('slug') slug: string,
    @Body() dto: ScheduleNewsPublicationDto,
  ) {
    return this.newsService.schedulePublication(slug, dto.scheduledAt);
  }

  /**
   * Huỷ lịch đăng CHƯA tới hạn. Lịch đã qua giờ nghĩa là bài đang công khai
   * (vị từ hiển thị của Batch 2), gỡ nó xuống là việc của `PATCH :slug/status`.
   */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Huỷ lịch đăng chưa tới hạn. Chỉ ADMIN trở lên.',
    description:
      'Đưa bài về `DRAFT`, xoá `scheduledAt` và `publishedAt` (mốc chưa từng thành sự thật). ' +
      'Lịch ĐÃ qua giờ bị từ chối 409: khi đó bài đã hiển thị công khai, dùng "Trả về nháp" để gỡ xuống.',
  })
  @ApiResponse({ status: 200, description: 'Đã huỷ lịch, bài về nháp.' })
  @ApiResponse({ status: 403, description: 'EDITOR không được huỷ lịch.' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy bài viết.' })
  @ApiResponse({
    status: 409,
    description: 'Bài không có lịch, hoặc lịch đã qua giờ đăng.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Delete(':slug/schedule')
  cancelScheduledPublication(@Param('slug') slug: string) {
    return this.newsService.cancelScheduledPublication(slug);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Delete(':slug')
  remove(@Param('slug') slug: string) {
    return this.newsService.remove(slug);
  }
}
