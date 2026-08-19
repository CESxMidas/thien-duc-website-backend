import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContentStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { json } from '../common/prisma-json';
import { assertContentStatusTransition } from '../common/content-approval';
import { assertContentEditAllowed } from '../common/content-editing';
import { cooperationPubliclyVisibleWhere } from '../common/publication';
import {
  clearedSchedule,
  editorMayEditScheduled,
  hasHistoricalPublication,
  isActiveFutureSchedule,
  publishedAtFor,
  type ScheduleState,
} from '../common/publication-schedule';
import { assertScheduleWindow } from '../common/schedule-window';
import { CreateCooperationProjectDto } from './dto/create-cooperation-project.dto';
import { UpdateCooperationProjectDto } from './dto/update-cooperation-project.dto';

/** Thông điệp 403 khi EDITOR sửa nội dung ngoài khâu biên tập. */
const EDIT_DENIED_MESSAGE =
  'Dự án hợp tác đã xuất bản hoặc đã được lên lịch nên biên tập viên không sửa được nội dung. Hãy nhờ quản trị viên.';

/**
 * Thông điệp 403 cho việc **sắp xếp lại thứ tự**.
 *
 * Tách khỏi thông điệp sửa nội dung vì nguyên nhân khác hẳn: người dùng không
 * sửa bản ghi nào cả, họ kéo một hàng — mà trong danh sách lại có bản đang chạy
 * trên trang chủ. Nói đúng nguyên nhân thì họ biết phải nhờ ai.
 */
const REORDER_DENIED_MESSAGE =
  'Danh sách có dự án hợp tác đã xuất bản hoặc đã lên lịch nên biên tập viên không đổi được thứ tự. Hãy nhờ quản trị viên.';

@Injectable()
export class CooperationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `publishedOnly` = true cho website công khai — lọc theo luật hiển thị dùng
   * chung (`cooperationPubliclyVisibleWhere`), nên dự án hợp tác đã tới hạn lên
   * lịch xuất hiện NGAY cả khi reconciler chưa kịp đổi `contentStatus`. Đây là
   * chỗ khiến tính đúng đắn không phụ thuộc cron: trên Render Free backend ngủ
   * sau 15 phút, lượt cron lúc 08:00 có thể không bao giờ chạy.
   *
   * Admin (false) vẫn thấy mọi trạng thái. `order` có thể trùng nhau nên chốt
   * thêm createdAt để thứ tự hiển thị ổn định giữa các lần gọi.
   */
  findAll(publishedOnly = false) {
    return this.prisma.cooperationProject.findMany({
      where: publishedOnly
        ? cooperationPubliclyVisibleWhere(new Date())
        : undefined,
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Nạp một bản ghi bất kể trạng thái — chỉ dùng cho Admin CMS và cho các lệnh
   * bên dưới. KHÔNG có route công khai nào gọi hàm này: dự án hợp tác không có
   * trang chi tiết, nó chỉ hiển thị trong section trang chủ qua `findAll(true)`.
   */
  async findOne(id: string) {
    const project = await this.prisma.cooperationProject.findUnique({
      where: { id },
    });
    if (!project) throw new NotFoundException('Không tìm thấy dự án hợp tác');
    return project;
  }

  /**
   * Tạo dự án hợp tác mới — **luôn** ở trạng thái nháp, với MỌI vai trò.
   *
   * Trước Batch 7 SUPER_ADMIN tạo là dự án hiện ngay ở section "Dự án hợp tác"
   * trang chủ. Nay công khai đi qua lệnh riêng `PATCH /cooperation/:id/status`,
   * nơi có kiểm vai trò. Quyền hạn KHÔNG đổi.
   */
  create(dto: CreateCooperationProjectDto) {
    return this.prisma.cooperationProject.create({
      data: {
        ...dto,
        name: json(dto.name),
        location: json(dto.location),
        role: json(dto.role),
        partner: json(dto.partner),
        scale: json(dto.scale),
        status: json(dto.status),
        // `status` ở trên là trạng thái mô tả (chữ) của dự án; ba cột dưới đây
        // mới là chuyện xuất bản — do SERVER đặt, ghi SAU `...dto` (Batch 6 đã
        // gỡ `contentStatus` khỏi DTO nội dung, Batch 10 không thêm lại hai cột
        // mốc vào đó).
        //
        // Không mốc công khai, không lịch — dự án chưa từng hiển thị cho ai. Đây
        // chính là điều kiện để `schedulePublication` chấp nhận hẹn giờ.
        contentStatus: ContentStatus.DRAFT,
        publishedAt: null,
        scheduledAt: null,
      } satisfies Prisma.CooperationProjectCreateInput,
    });
  }

  /**
   * Sửa NỘI DUNG — cố ý không đụng tới trạng thái xuất bản, và chỉ cho phép khi
   * vai trò + trạng thái hiện tại cho phép.
   *
   * Hai chốt khác nhau, cùng nằm ở đây:
   *
   * 1. **Không ghi được ba cột xuất bản** (Batch 6 cho `contentStatus`, Batch 10
   *    thêm hai cột mốc) — sửa nội dung không bao giờ là lệnh xuất bản.
   * 2. **Không sửa được nội dung đã rời khâu biên tập** nếu là EDITOR. `status`
   *    (trạng thái mô tả bằng CHỮ của dự án) vẫn sửa bình thường ở các trạng
   *    thái được phép; nó không phải trạng thái xuất bản.
   *
   * `...dto` được spread thẳng xuống Prisma, nên bất cứ field nào lọt vào DTO
   * cũng ghi được xuống DB. Đó chính là cách `contentStatus` từng biến route
   * này (mở cho EDITOR) thành đường đăng bài tắt, bỏ qua `updateStatus` và
   * `assertContentStatusTransition`. Chốt chặn nằm ở sự VẮNG MẶT của field
   * trong `CreateCooperationProjectDto` cộng `forbidNonWhitelisted`; khoá lại
   * bằng `cooperation-status-write-block.spec.ts`.
   *
   * Thêm field mới vào DTO nội dung thì cân nhắc: nó có phải thứ EDITOR được
   * phép tự quyết không? Trạng thái xuất bản và lịch đăng thì KHÔNG.
   */
  async update(
    id: string,
    dto: UpdateCooperationProjectDto,
    actorRole?: string,
  ) {
    const project = await this.findOne(id);
    assertContentEditAllowed(
      actorRole,
      editorMayEditScheduled(project),
      EDIT_DENIED_MESSAGE,
    );
    return this.prisma.cooperationProject.update({
      where: { id },
      data: {
        ...dto,
        name: json(dto.name),
        location: json(dto.location),
        role: json(dto.role),
        partner: json(dto.partner),
        scale: json(dto.scale),
        status: json(dto.status),
        // Lớp chốt thứ hai cho ba cột do SERVER sở hữu, đặt SAU `...dto` nên
        // luôn thắng: sửa nội dung không bao giờ đổi trạng thái xuất bản hay
        // lịch đăng. `undefined` = Prisma giữ nguyên cột. DTO đã không khai báo
        // ba field này, nhưng phòng thủ không nên phụ thuộc vào việc một DTO ở
        // file khác mãi mãi giữ đúng hình dạng.
        contentStatus: undefined,
        publishedAt: undefined,
        scheduledAt: undefined,
      } satisfies Prisma.CooperationProjectUpdateInput,
    });
  }

  /**
   * Cửa DUY NHẤT đổi trạng thái thủ công (ngoài hai lệnh lịch bên dưới).
   *
   * Ngữ nghĩa mốc thời gian khớp từng ca với Dự án — xem `publishedAtFor`:
   * "Đăng ngay" một bản đang hẹn lịch cho mốc **bây giờ** (lần đăng theo lịch
   * kia đã không xảy ra); đăng lại một bản từng công khai giữ nguyên mốc gốc;
   * trả về nháp KHÔNG xoá lịch sử xuất bản thật.
   */
  async updateStatus(id: string, status: ContentStatus, actorRole?: string) {
    const project = await this.findOne(id);
    // EDITOR chỉ được gửi duyệt (DRAFT → PENDING); ADMIN trở lên đặt tùy ý.
    assertContentStatusTransition(actorRole, project.contentStatus, status);
    const now = new Date();
    return this.prisma.cooperationProject.update({
      where: { id },
      data: {
        contentStatus: status,
        publishedAt: publishedAtFor(project, status, now),
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
   * contentStatus = PENDING
   * scheduledAt   = mốc yêu cầu
   * publishedAt   = mốc yêu cầu      ← bất biến của lịch
   * ```
   *
   * KHÔNG đụng tới `status` (chữ mô tả) và `order` — đặt lịch không phải sửa
   * nội dung.
   *
   * Vì sao `publishedAt` ghi **ngay bây giờ** chứ không đợi reconciler: vị từ
   * hiển thị cho một bản PENDING đã tới hạn ra công khai *trước khi* cron chạy.
   * Mốc phải sẵn sàng từ trước thời điểm nội dung có thể hiển thị.
   *
   * Vì sao trạng thái lưu là `PENDING` chứ không phải một enum `SCHEDULED` mới:
   * PENDING vừa đúng nghĩa (đã qua uỷ quyền của ADMIN, đang chờ), vừa **fail
   * safe** — mọi truy vấn cũ chỉ lọc `contentStatus = 'PUBLISHED'` mà ta lỡ bỏ
   * sót đều tự động giấu bản ghi này đi. Rủi ro của việc quên là "hiện muộn",
   * không phải "rò rỉ sớm".
   *
   * Đây cũng chính là cách ADMIN **duyệt bằng lịch** một bản do EDITOR gửi lên:
   * bản đó đang `PENDING` chưa hẹn giờ, đặt lịch giữ nguyên PENDING và gắn mốc.
   */
  async schedulePublication(id: string, scheduledAtIso: string) {
    const project = await this.findOne(id);
    // MỘT `now` cho cả kiểm tra lẫn ghi — dùng hai mốc khác nhau thì một lịch
    // sát ngưỡng có thể qua được validate rồi ghi xuống ở trạng thái không hợp lệ.
    const now = new Date();
    const scheduledAt = new Date(scheduledAtIso);

    if (project.contentStatus === ContentStatus.PUBLISHED) {
      // Bản ghi đang phục vụ section "Dự án hợp tác" ở trang chủ. Đặt lịch cho
      // nó chỉ có hai cách hiểu, cả hai đều đánh lừa người dùng — hoặc nội dung
      // mới lên ngay lập tức (lịch vô nghĩa), hoặc thẻ đang hiển thị biến mất
      // tới giờ hẹn.
      //
      // Nhánh này KHÔNG cần `publishedAt`, nên nó vẫn đúng với dữ liệu cũ tạo
      // trước khi hai cột mốc tồn tại: `contentStatus = PUBLISHED` một mình đã
      // chứng minh bản ghi đang công khai.
      throw new ConflictException(
        'Dự án hợp tác đang được đăng công khai nên không đặt lịch được.',
      );
    }

    // Bản TỪNG công khai thì không hẹn giờ lại được ở v1, kể cả khi đã gỡ về
    // nháp. Ghi lịch mới sẽ ghi đè `publishedAt` — mà mốc đó luôn có nghĩa là
    // **lần công khai ĐẦU TIÊN**. Ghi đè nó là âm thầm định nghĩa lại field
    // thành "lần đăng gần nhất".
    //
    // Nhánh này cũng chặn luôn ca "lịch đã tới hạn": khi `scheduledAt <= now`,
    // `isActiveFutureSchedule` trả false nên bản ghi bị coi là đã có lịch sử
    // xuất bản — đúng như thực tế, vì vị từ hiển thị đã cho nó ra công khai.
    if (hasHistoricalPublication(project, now)) {
      throw new ConflictException(
        'Dự án hợp tác này đã từng được đăng nên không đặt lịch đăng lại được.',
      );
    }

    // Ngưỡng tối thiểu 1 phút / tối đa 2 năm — dùng chung với Tin tức và Dự án.
    assertScheduleWindow(scheduledAt, now);

    return this.prisma.cooperationProject.update({
      where: { id: project.id },
      data: {
        contentStatus: ContentStatus.PENDING,
        scheduledAt,
        publishedAt: scheduledAt,
      },
    });
  }

  /**
   * Huỷ lịch đăng — đưa bản ghi về trạng thái nháp sạch sẽ.
   *
   * **Chỉ áp dụng cho lịch CHƯA tới hạn.** Nếu `scheduledAt <= now` thì theo vị
   * từ hiển thị, dự án hợp tác **đã đang hiển thị công khai** rồi, dù
   * `contentStatus` còn là PENDING vì reconciler chưa chạy. Lúc đó thao tác
   * không còn là "huỷ một việc chưa xảy ra" mà là **gỡ nội dung đang công
   * khai** — một hành động khác hẳn, đã có nút riêng ("Trả về nháp"), và có hệ
   * quả khác với `publishedAt`.
   *
   * Trạng thái sau khi huỷ:
   * ```
   * contentStatus = DRAFT
   * scheduledAt   = NULL
   * publishedAt   = NULL     ← chưa từng công khai nên mốc đó chỉ là ý định
   * ```
   *
   * Việc này **thu hồi luôn phê duyệt** — cố ý ở v1: không có trạng thái "đã
   * duyệt nhưng chưa lên lịch", và thêm một enum như thế là đổi mô hình trạng
   * thái.
   */
  async cancelScheduledPublication(id: string) {
    const project = await this.findOne(id);
    const now = new Date();

    if (project.scheduledAt === null) {
      throw new ConflictException('Dự án hợp tác này không có lịch đăng nào.');
    }
    if (project.scheduledAt.getTime() <= now.getTime()) {
      throw new ConflictException(
        'Đã qua giờ đăng theo lịch nên dự án hợp tác đang hiển thị công khai. Dùng "Trả về nháp" để gỡ xuống.',
      );
    }
    // Còn lại: `scheduledAt` ở tương lai nhưng bản ghi KHÔNG phải một lịch hợp
    // lệ — từng công khai và bị gán thêm lịch, hoặc tổ hợp dị dạng từ dữ liệu
    // cũ. Nhánh xoá bên dưới sẽ xoá `publishedAt`, mà ở đây mốc đó là lịch sử
    // thật. Từ chối thay vì xoá lịch sử.
    if (!isActiveFutureSchedule(project, now)) {
      throw new ConflictException(
        'Dự án hợp tác này đã từng được đăng nên không huỷ lịch theo cách này được. Dùng "Trả về nháp" để gỡ xuống.',
      );
    }

    return this.prisma.cooperationProject.update({
      where: { id: project.id },
      data: {
        contentStatus: ContentStatus.DRAFT,
        scheduledAt: null,
        publishedAt: null,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.cooperationProject.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Nhận toàn bộ id theo thứ tự mong muốn và ghi lại `order`. Bắt buộc gửi đủ
   * danh sách để không còn bản ghi mang `order` cũ xen lẫn vào giữa dãy mới.
   *
   * ## Vì sao thao tác này chịu chốt quyền xuất bản (Batch 10)
   *
   * `order` **là nội dung công khai**: nó quyết định thứ tự các thẻ chạy trong
   * section "Dự án hợp tác" ở trang chủ, và thẻ đầu tiên là thẻ người xem thấy
   * trước. Một EDITOR không sửa được nội dung của bản đã đăng nhưng lại kéo
   * được nó từ vị trí 1 xuống vị trí cuối thì chốt quyền kia chỉ là hình thức —
   * đúng cùng một lỗ hổng đã vá ở `reorderGallery` của Dự án.
   *
   * Chốt áp cho **toàn bộ** danh sách chứ không chỉ hàng bị kéo, vì lệnh này
   * ghi lại `order` của mọi bản ghi: bất kỳ bản nào trong danh sách cũng có thể
   * đổi vị trí. Mà lệnh lại bắt gửi ĐỦ danh sách, nên hệ quả thực tế là: EDITOR
   * chỉ sắp xếp được khi **mọi** dự án hợp tác còn đang trong khâu biên tập.
   * Đây là kết luận đúng chứ không phải tác dụng phụ — một khi đã có bản chạy
   * trên trang chủ thì mọi thay đổi thứ tự đều là thay đổi nội dung công khai.
   *
   * Kiểm TRƯỚC, ghi SAU: nạp đủ bản ghi, xét quyền trên trạng thái ĐÃ LƯU (không
   * bao giờ tin `contentStatus` do client gửi lên — thân request ở đây chỉ có
   * id), rồi mới vào transaction. Từ chối là không ghi một dòng nào.
   */
  async reorder(ids: string[], actorRole?: string) {
    const total = await this.prisma.cooperationProject.count();
    const unique = new Set(ids);

    if (unique.size !== ids.length) {
      throw new BadRequestException('Danh sách id dự án hợp tác bị trùng lặp');
    }
    if (ids.length !== total) {
      throw new BadRequestException(
        `Phải gửi đủ ${total} dự án hợp tác, hiện nhận ${ids.length}`,
      );
    }

    const affected = await this.prisma.cooperationProject.findMany({
      where: { id: { in: ids } },
      select: { contentStatus: true, scheduledAt: true, publishedAt: true },
    });
    if (affected.length !== ids.length) {
      throw new BadRequestException('Có id dự án hợp tác không tồn tại');
    }

    assertContentEditAllowed(
      actorRole,
      affected.every((project: ScheduleState) =>
        editorMayEditScheduled(project),
      ),
      REORDER_DENIED_MESSAGE,
    );

    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.cooperationProject.update({
          where: { id },
          data: { order: index },
        }),
      ),
    );
    return this.findAll();
  }
}
