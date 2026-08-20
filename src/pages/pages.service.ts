import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContentStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { json } from '../common/prisma-json';
import { assertContentStatusTransition } from '../common/content-approval';
import { assertContentEditAllowed } from '../common/content-editing';
import {
  isPubliclyVisible,
  pagePubliclyVisibleWhere,
} from '../common/publication';
import {
  clearedSchedule,
  editorMayEditScheduled,
  hasHistoricalPublication,
  isActiveFutureSchedule,
  publishedAtFor,
  type ScheduleState,
} from '../common/publication-schedule';
import { assertScheduleWindow } from '../common/schedule-window';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';

const UNIQUE_CONSTRAINT = 'P2002';

/** Thông điệp 403 khi EDITOR sửa nội dung ngoài khâu biên tập. */
const EDIT_DENIED_MESSAGE =
  'Trang đã xuất bản hoặc đã được lên lịch nên biên tập viên không sửa được nội dung. Hãy nhờ quản trị viên.';

/**
 * Hình dạng tối thiểu để xét trạng thái xuất bản/lịch của một trang.
 *
 * `Page` gọi cột bậc thang duyệt là **`status`** (giống `NewsPost`), trong khi
 * các vị từ dùng chung ở `common/publication-schedule.ts` nhận `contentStatus`.
 * Đổi tên đi qua đúng một hàm chuyển có kiểu chặt (`toScheduleState`) thay vì
 * chép lại luật: phép so `publishedAt === scheduledAt` để phân biệt *dự định*
 * với *lịch sử thật* là chỗ tinh tế nhất của cả cơ chế, mỗi bản sao là một cơ
 * hội để hai module trả lời khác nhau cho cùng một câu hỏi.
 */
type PagePublicationState = {
  status: ContentStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
};

/** Đưa trang về hình dạng chung mà các vị từ lịch nhận vào. */
function toScheduleState(page: PagePublicationState): ScheduleState {
  return {
    contentStatus: page.status,
    scheduledAt: page.scheduledAt,
    publishedAt: page.publishedAt,
  };
}

@Injectable()
export class PagesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `publishedOnly` = true cho website công khai — lọc theo luật hiển thị dùng
   * chung (`pagePubliclyVisibleWhere`), nên trang đã tới hạn lên lịch xuất hiện
   * NGAY cả khi reconciler chưa kịp đổi `status`. Đây là chỗ khiến tính đúng đắn
   * không phụ thuộc cron: trên Render Free backend ngủ sau 15 phút, lượt cron
   * lúc 08:00 có thể không bao giờ chạy. Admin (false) vẫn thấy mọi trạng thái.
   */
  findAll(publishedOnly = false) {
    return this.prisma.page.findMany({
      where: publishedOnly ? pagePubliclyVisibleWhere(new Date()) : undefined,
      orderBy: { slug: 'asc' },
    });
  }

  /**
   * `publishedOnly` bắt buộc bật ở route công khai — nếu không, trang nháp và
   * trang chờ duyệt sẽ đọc được từ bên ngoài chỉ bằng cách đoán slug.
   *
   * Trang CHƯA tới hạn lên lịch ném **đúng** `NotFoundException` như trang nháp:
   * không mã lỗi riêng, không "sắp ra mắt", không lộ `scheduledAt`. Người ngoài
   * không được phân biệt "không tồn tại" với "sắp công khai".
   */
  async findBySlug(slug: string, publishedOnly = false) {
    const page = await this.prisma.page.findUnique({ where: { slug } });
    if (!page || (publishedOnly && !isPubliclyVisible(page, new Date()))) {
      throw new NotFoundException('Không tìm thấy trang');
    }
    return page;
  }

  /**
   * Tạo trang mới — **luôn** ở trạng thái nháp, với MỌI vai trò.
   *
   * Trước Batch 7 SUPER_ADMIN tạo trang là trang lên website ngay. Với trang nội
   * dung thì điều đó còn khó chịu hơn tin tức: trang mới thường được dựng dần
   * qua nhiều lần lưu, mà mỗi lần lưu đầu tiên đã là một URL công khai còn dở
   * dang. Nay công khai đi qua lệnh riêng `PATCH /pages/:slug/status`.
   */
  async create(dto: CreatePageDto) {
    try {
      return await this.prisma.page.create({
        data: {
          ...dto,
          title: json(dto.title),
          content: json(dto.content),
          // Ba cột xuất bản do SERVER đặt, ghi SAU `...dto`. DTO nội dung không
          // khai báo chúng nên `forbidNonWhitelisted` đã chặn từ tầng
          // ValidationPipe; những dòng này là lớp chốt thứ hai.
          //
          // Không mốc công khai, không lịch — trang chưa từng hiển thị cho ai.
          // Đây chính là điều kiện để `schedulePublication` chấp nhận hẹn giờ.
          status: ContentStatus.DRAFT,
          publishedAt: null,
          scheduledAt: null,
        } satisfies Prisma.PageCreateInput,
      });
    } catch (error) {
      this.rethrowSlugConflict(error);
    }
  }

  /**
   * Sửa nội dung trang.
   *
   * Thứ tự BẮT BUỘC: nạp bản ghi → chốt quyền theo trạng thái ĐÃ LƯU → mới ghi.
   * EDITOR sửa được nháp chưa từng công khai và trang chờ duyệt CHƯA hẹn giờ;
   * ADMIN trở lên không đổi.
   */
  async update(slug: string, dto: UpdatePageDto, actorRole?: string) {
    const page = await this.findBySlug(slug);
    assertContentEditAllowed(
      actorRole,
      editorMayEditScheduled(toScheduleState(page)),
      EDIT_DENIED_MESSAGE,
    );
    try {
      return await this.prisma.page.update({
        where: { id: page.id },
        data: {
          ...dto,
          title: json(dto.title),
          content: json(dto.content),
          // Lớp chốt thứ hai cho ba cột do SERVER sở hữu, đặt SAU `...dto` nên
          // luôn thắng: sửa nội dung không bao giờ đổi trạng thái xuất bản hay
          // lịch đăng. `undefined` = Prisma giữ nguyên cột. DTO đã không khai
          // báo ba field này, nhưng phòng thủ không nên phụ thuộc vào việc một
          // DTO ở file khác mãi mãi giữ đúng hình dạng.
          status: undefined,
          publishedAt: undefined,
          scheduledAt: undefined,
        } satisfies Prisma.PageUpdateInput,
      });
    } catch (error) {
      this.rethrowSlugConflict(error);
    }
  }

  /**
   * Cửa DUY NHẤT đổi trạng thái thủ công (ngoài hai lệnh lịch bên dưới).
   *
   * Ngữ nghĩa mốc thời gian khớp từng ca với Dự án và Dự án hợp tác — xem
   * `publishedAtFor`: "Đăng ngay" một trang đang hẹn lịch cho mốc **bây giờ**
   * (lần đăng theo lịch kia đã không xảy ra); đăng lại một trang từng công khai
   * giữ nguyên mốc gốc; trả về nháp KHÔNG xoá lịch sử xuất bản thật.
   */
  async updateStatus(slug: string, status: ContentStatus, actorRole?: string) {
    const page = await this.findBySlug(slug);
    // EDITOR chỉ được gửi duyệt (DRAFT → PENDING); ADMIN trở lên đặt tùy ý.
    assertContentStatusTransition(actorRole, page.status, status);
    const now = new Date();
    return this.prisma.page.update({
      where: { id: page.id },
      data: {
        status,
        publishedAt: publishedAtFor(page, status, now),
        scheduledAt: clearedSchedule(status),
      },
    });
  }

  /**
   * Đặt (hoặc đổi) lịch đăng — lệnh riêng, chốt ADMIN+ ở controller.
   *
   * Ghi **nguyên tử ba cột** trong một câu UPDATE:
   *
   * ```
   * status      = PENDING
   * scheduledAt = mốc yêu cầu
   * publishedAt = mốc yêu cầu      ← bất biến của lịch
   * ```
   *
   * KHÔNG đụng `slug`, `title`, `content` — đặt lịch không phải sửa nội dung.
   *
   * Vì sao `publishedAt` ghi **ngay bây giờ** chứ không đợi reconciler: vị từ
   * hiển thị cho một trang PENDING đã tới hạn ra công khai *trước khi* cron
   * chạy. Mốc phải sẵn sàng từ trước thời điểm nội dung có thể hiển thị.
   *
   * Vì sao trạng thái lưu là `PENDING` chứ không phải một enum `SCHEDULED` mới:
   * PENDING vừa đúng nghĩa (đã qua uỷ quyền của ADMIN, đang chờ), vừa **fail
   * safe** — mọi truy vấn cũ chỉ lọc `status = 'PUBLISHED'` mà ta lỡ bỏ sót đều
   * tự động giấu trang này đi. Rủi ro của việc quên là "hiện muộn", không phải
   * "rò rỉ sớm".
   *
   * Đây cũng chính là cách ADMIN **duyệt bằng lịch** một trang do EDITOR gửi
   * lên: trang đó đang `PENDING` chưa hẹn giờ, đặt lịch giữ nguyên PENDING và
   * gắn mốc.
   */
  async schedulePublication(slug: string, scheduledAtIso: string) {
    const page = await this.findBySlug(slug);
    // MỘT `now` cho cả kiểm tra lẫn ghi — dùng hai mốc khác nhau thì một lịch
    // sát ngưỡng có thể qua được validate rồi ghi xuống ở trạng thái không hợp lệ.
    const now = new Date();
    const scheduledAt = new Date(scheduledAtIso);
    const state = toScheduleState(page);

    if (page.status === ContentStatus.PUBLISHED) {
      // Không có versioning nội dung: một slug là một hàng, đang phục vụ một URL
      // công khai. Đặt lịch cho nó chỉ có hai cách hiểu, cả hai đều đánh lừa
      // người dùng — hoặc nội dung mới lên ngay lập tức (lịch vô nghĩa), hoặc
      // URL đang được index biến mất tới giờ hẹn.
      //
      // Nhánh này KHÔNG cần `publishedAt`, nên nó vẫn đúng với dữ liệu cũ tạo
      // trước khi hai cột mốc tồn tại: `status = PUBLISHED` một mình đã chứng
      // minh trang đang công khai.
      throw new ConflictException(
        'Trang đang được đăng công khai nên không đặt lịch được.',
      );
    }

    // Trang TỪNG công khai thì không hẹn giờ lại được ở v1, kể cả khi đã gỡ về
    // nháp. Ghi lịch mới sẽ ghi đè `publishedAt` — mà mốc đó luôn có nghĩa là
    // **lần công khai ĐẦU TIÊN**. Ghi đè nó là âm thầm định nghĩa lại field
    // thành "lần đăng gần nhất".
    //
    // Nhánh này cũng chặn luôn ca "lịch đã tới hạn": khi `scheduledAt <= now`,
    // `isActiveFutureSchedule` trả false nên bản ghi bị coi là đã có lịch sử
    // xuất bản — đúng như thực tế, vì vị từ hiển thị đã cho nó ra công khai.
    if (hasHistoricalPublication(state, now)) {
      throw new ConflictException(
        'Trang này đã từng được đăng nên không đặt lịch đăng lại được.',
      );
    }

    // Ngưỡng tối thiểu 1 phút / tối đa 2 năm — dùng chung với các module khác.
    assertScheduleWindow(scheduledAt, now);

    return this.prisma.page.update({
      where: { id: page.id },
      data: {
        status: ContentStatus.PENDING,
        scheduledAt,
        publishedAt: scheduledAt,
      },
    });
  }

  /**
   * Huỷ lịch đăng — đưa trang về trạng thái nháp sạch sẽ.
   *
   * **Chỉ áp dụng cho lịch CHƯA tới hạn.** Nếu `scheduledAt <= now` thì theo vị
   * từ hiển thị, trang **đã đang hiển thị công khai** rồi, dù `status` còn là
   * PENDING vì reconciler chưa chạy. Lúc đó thao tác không còn là "huỷ một việc
   * chưa xảy ra" mà là **gỡ nội dung đang công khai** — một hành động khác hẳn,
   * đã có nút riêng ("Trả về nháp"), và có hệ quả khác với `publishedAt`.
   *
   * Trạng thái sau khi huỷ:
   * ```
   * status      = DRAFT
   * scheduledAt = NULL
   * publishedAt = NULL     ← trang chưa từng công khai nên mốc đó chỉ là ý định
   * ```
   *
   * Việc này **thu hồi luôn phê duyệt** — cố ý ở v1: không có trạng thái "đã
   * duyệt nhưng chưa lên lịch", và thêm một enum như thế là đổi mô hình trạng thái.
   */
  async cancelScheduledPublication(slug: string) {
    const page = await this.findBySlug(slug);
    const now = new Date();
    const state = toScheduleState(page);

    if (page.scheduledAt === null) {
      throw new ConflictException('Trang này không có lịch đăng nào.');
    }
    if (page.scheduledAt.getTime() <= now.getTime()) {
      throw new ConflictException(
        'Đã qua giờ đăng theo lịch nên trang đang hiển thị công khai. Dùng "Trả về nháp" để gỡ trang xuống.',
      );
    }
    // Còn lại: `scheduledAt` ở tương lai nhưng bản ghi KHÔNG phải một lịch hợp
    // lệ — trang từng công khai và bị gán thêm lịch, hoặc tổ hợp dị dạng từ dữ
    // liệu cũ. Nhánh xoá bên dưới sẽ xoá `publishedAt`, mà ở đây mốc đó là lịch
    // sử thật. Từ chối thay vì xoá lịch sử.
    if (!isActiveFutureSchedule(state, now)) {
      throw new ConflictException(
        'Trang này đã từng được đăng nên không huỷ lịch theo cách này được. Dùng "Trả về nháp" để gỡ trang xuống.',
      );
    }

    return this.prisma.page.update({
      where: { id: page.id },
      data: {
        status: ContentStatus.DRAFT,
        scheduledAt: null,
        publishedAt: null,
      },
    });
  }

  async remove(slug: string) {
    const page = await this.findBySlug(slug);
    await this.prisma.page.delete({ where: { id: page.id } });
    return { deleted: true };
  }

  private rethrowSlugConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_CONSTRAINT
    ) {
      throw new ConflictException('Slug trang đã tồn tại');
    }
    throw error as Error;
  }
}
