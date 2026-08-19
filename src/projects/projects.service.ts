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
  isProjectPubliclyVisible,
  projectPubliclyVisibleWhere,
} from '../common/publication';
import { assertScheduleWindow } from '../common/schedule-window';
import { CreateGalleryImageDto } from './dto/create-gallery-image.dto';
import { CreateProjectItemDto } from './dto/create-project-item.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateGalleryImageDto } from './dto/update-gallery-image.dto';
import { UpdateProjectItemDto } from './dto/update-project-item.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

/** Mã lỗi Prisma khi vi phạm ràng buộc duy nhất (`slug` dự án, `[projectId, slug]` hạng mục). */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === PRISMA_UNIQUE_VIOLATION;
}

/** Ảnh và hạng mục luôn trả theo `order` tăng dần — thứ tự do biên tập viên đặt. */
const BY_ORDER = { order: 'asc' } as const;

/**
 * `scheduledAt` phải bị xoá khi đổi trạng thái **thủ công** sang PUBLISHED hoặc
 * DRAFT — trả `null` để xoá, `undefined` để không đụng tới cột.
 *
 * Vì sao cần: một dự án từng lên lịch rồi được ADMIN gỡ về nháp mà vẫn giữ
 * `scheduled_at` ở quá khứ sẽ là một hàng dị dạng (DRAFT + lịch quá khứ). Vị từ
 * hiển thị và reconciler đều đòi `PENDING` nên nó không lọt ra công khai được,
 * nhưng để lại rác đó là mời gọi một lỗi trong tương lai.
 *
 * PENDING cố ý KHÔNG xoá: "đã lên lịch" chính là `PENDING` + `scheduledAt`. Xoá
 * ở đây sẽ huỷ lịch âm thầm mỗi lần ADMIN chuyển dự án về hàng chờ duyệt.
 */
function clearedSchedule(next: ContentStatus): null | undefined {
  return next === ContentStatus.PUBLISHED || next === ContentStatus.DRAFT
    ? null
    : undefined;
}

/** Thông điệp 403 khi EDITOR sửa nội dung của dự án đã xuất bản. */
const EDIT_DENIED_MESSAGE =
  'Dự án đã xuất bản hoặc đã được lên lịch nên biên tập viên không sửa được nội dung. Hãy nhờ quản trị viên.';

/**
 * Thông điệp 403 cho **nội dung con** (hạng mục, thư viện ảnh).
 *
 * Nói rõ hạng mục/ảnh thay vì dùng chung câu của dự án cha: người dùng đang bấm
 * "Thêm hạng mục" mà nhận câu "không sửa được nội dung dự án" thì sẽ tưởng mình
 * bấm sai chỗ.
 */
const CHILD_EDIT_DENIED_MESSAGE =
  'Dự án đã xuất bản hoặc đã được lên lịch nên biên tập viên không sửa được hạng mục và thư viện ảnh của nó. Hãy nhờ quản trị viên.';

/**
 * Hình dạng tối thiểu để xét trạng thái xuất bản/lịch của một dự án.
 *
 * `contentStatus` là bậc thang duyệt. **KHÔNG** phải `Project.status` — cột đó
 * là tình trạng thi công (đang thi công / đã bàn giao) và không liên quan gì
 * tới việc nội dung có ra công khai hay không.
 */
type ProjectScheduleState = {
  contentStatus: ContentStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
};

/** Dự án đã **thật sự** ra công khai bao giờ chưa (mốc nằm ở quá khứ)? */
function hasBeenPublic(
  project: { publishedAt: Date | null },
  now: Date,
): boolean {
  return (
    project.publishedAt !== null &&
    project.publishedAt.getTime() <= now.getTime()
  );
}

/**
 * Dự án có đang giữ một **lịch tương lai hợp lệ** không? (Đổi được, huỷ được.)
 *
 * Bốn điều kiện đều cần — giống hệt luật đã chốt cho tin tức. `publishedAt`
 * **đúng bằng** `scheduledAt` là dấu hiệu mốc kia do chính lệnh đặt lịch ghi ra
 * (một *dự định* chưa thành sự thật), phân biệt với lịch sử xuất bản THẬT.
 */
function isActiveFutureSchedule(
  project: ProjectScheduleState,
  now: Date,
): boolean {
  return (
    project.contentStatus === ContentStatus.PENDING &&
    project.scheduledAt !== null &&
    project.publishedAt !== null &&
    project.scheduledAt.getTime() > now.getTime() &&
    project.publishedAt.getTime() === project.scheduledAt.getTime()
  );
}

/**
 * Dự án đã có **lịch sử xuất bản thật** chưa? Có `publishedAt`, và mốc đó không
 * phải dự định của một lịch tương lai đang chờ.
 */
function hasHistoricalPublication(
  project: ProjectScheduleState,
  now: Date,
): boolean {
  return project.publishedAt !== null && !isActiveFutureSchedule(project, now);
}

/**
 * **EDITOR có được sửa nội dung dự án này không?** (Batch 9 siết lại luật của
 * Batch 8.)
 *
 * Trước Batch 9, dự án chưa có cột mốc thời gian nên luật đành lấy phần chắc
 * chắn: chặn ở `PUBLISHED`, cho sửa mọi `PENDING`. Nay dự án hẹn giờ được, và
 * "mọi PENDING" không còn đủ — một dự án ĐÃ ĐƯỢC ADMIN LÊN LỊCH vẫn lưu là
 * `PENDING`. Để nguyên luật cũ là mở lại đúng lỗ hổng 07:59 mà Batch 8 đóng,
 * lần này trên dự án:
 *
 * ```
 * 07:00  ADMIN hẹn đăng dự án lúc 08:00   (PENDING + scheduledAt)
 * 07:59  EDITOR sửa nội dung
 * 08:00  bản ĐÃ SỬA tự ra công khai
 * ```
 *
 * Luật mới khớp từng ca với tin tức: cho sửa nháp chưa từng công khai và dự án
 * chờ duyệt CHƯA hẹn giờ; chặn lịch tương lai, lịch đã tới hạn, dự án đang đăng,
 * và nháp từng đăng. Không cần đồng hồ: lệnh đặt lịch ghi
 * `publishedAt = scheduledAt`, nên chỉ cần *sự tồn tại* của mốc.
 *
 * Cooperation và Page vẫn dùng `editorMayEditUnpublished` — chúng chưa có cột
 * mốc nào để mà xét, và Batch 9 cố ý không đụng tới hai module đó.
 */
function editorMayEditProject(project: ProjectScheduleState): boolean {
  if (project.publishedAt !== null) return false;
  if (project.contentStatus === ContentStatus.DRAFT) return true;
  return (
    project.contentStatus === ContentStatus.PENDING &&
    project.scheduledAt === null
  );
}

/**
 * Các cột JSON tùy chọn: khi Admin muốn **xóa** nội dung (vd. bỏ bản đồ), payload
 * gửi `null`. Prisma không nhận `null` trực tiếp cho cột Json? — phải quy đổi sang
 * `Prisma.DbNull`. Bỏ qua `undefined` (không đụng tới field đó).
 */
const NULLABLE_JSON_FIELDS = [
  'description',
  'location',
  'category',
  'highlights',
  'quickFacts',
  'gallerySections',
  'mapLocation',
] as const;

function normalizeJsonNulls<T extends object>(dto: T): T {
  const out = { ...dto } as Record<string, unknown>;
  for (const field of NULLABLE_JSON_FIELDS) {
    if (out[field] === null) out[field] = Prisma.DbNull;
  }
  return out as T;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `publishedOnly` = true cho website công khai — lọc theo luật hiển thị dùng
   * chung (`projectPubliclyVisibleWhere`), nên dự án đã tới hạn lên lịch xuất
   * hiện NGAY cả khi reconciler chưa kịp đổi `contentStatus`. Đây là chỗ khiến
   * tính đúng đắn không phụ thuộc cron: trên Render Free backend ngủ sau 15
   * phút, lượt cron lúc 08:00 có thể không bao giờ chạy. Admin (false) vẫn thấy
   * mọi trạng thái.
   */
  findAll(publishedOnly = false) {
    return this.prisma.project.findMany({
      where: publishedOnly
        ? projectPubliclyVisibleWhere(new Date())
        : undefined,
      orderBy: { order: 'asc' },
      include: {
        items: { orderBy: BY_ORDER },
        _count: { select: { galleryImages: true } },
      },
    });
  }

  /**
   * `publishedOnly` bắt buộc bật ở route công khai — nếu không, dự án nháp và
   * dự án chờ duyệt đọc được từ bên ngoài chỉ bằng cách đoán slug (cùng lỗi đã
   * vá ở `news` và `pages`).
   *
   * Dự án CHƯA tới hạn lên lịch ném **đúng** `NotFoundException` như dự án nháp:
   * không mã lỗi riêng, không "sắp ra mắt", không lộ `scheduledAt`. Người ngoài
   * không được phân biệt "không tồn tại" với "sắp công khai".
   */
  async findBySlug(slug: string, publishedOnly = false) {
    const project = await this.prisma.project.findUnique({
      where: { slug },
      include: {
        items: { orderBy: BY_ORDER },
        galleryImages: { orderBy: BY_ORDER },
      },
    });
    if (
      !project ||
      (publishedOnly && !isProjectPubliclyVisible(project, new Date()))
    ) {
      throw new NotFoundException('Không tìm thấy dự án');
    }
    return project;
  }

  async findItemBySlug(
    projectSlug: string,
    itemSlug: string,
    publishedOnly = false,
  ) {
    const { item } = await this.findItemWithProject(
      projectSlug,
      itemSlug,
      publishedOnly,
    );
    return item;
  }

  /**
   * Hạng mục **kèm dự án cha** — dùng cho các lệnh ghi cần chốt quyền theo
   * `contentStatus` của cha.
   *
   * Tồn tại vì `findItemBySlug` chỉ trả hạng mục (đó là response body của route
   * GET, không được đổi hình dạng), nhưng cha đã được nạp ngay bên trong. Trả
   * luôn cả hai thay vì gọi `findBySlug` lần nữa: một truy vấn dư cho mỗi lệnh
   * ghi, và tệ hơn là hai lần đọc có thể thấy hai trạng thái khác nhau.
   */
  private async findItemWithProject(
    projectSlug: string,
    itemSlug: string,
    publishedOnly = false,
  ) {
    const project = await this.findBySlug(projectSlug, publishedOnly);
    const item = await this.prisma.projectItem.findFirst({
      where: { projectId: project.id, slug: itemSlug },
      include: { galleryImages: { orderBy: BY_ORDER } },
    });
    if (!item) throw new NotFoundException('Không tìm thấy hạng mục dự án');
    return { project, item };
  }

  /**
   * **Chốt quyền sửa NỘI DUNG CON theo trạng thái của dự án CHA.**
   *
   * `ProjectItem` và `ProjectGalleryImage` không có trạng thái xuất bản riêng —
   * chúng hiển thị công khai *vì* dự án cha hiển thị công khai. Nên quyền sửa
   * chúng phải thừa hưởng đúng luật quản trị của cha, nếu không sẽ còn một đường
   * vòng: chặn `PATCH /projects/:slug` nhưng vẫn cho EDITOR đổi hạng mục và ảnh
   * của một dự án đang chạy trên website — nội dung công khai vẫn thay đổi mà
   * không ai duyệt lại.
   *
   * Dùng lại đúng bậc thang vai trò của Batch 8 (`assertContentEditAllowed`) và
   * đúng vị từ của dự án (`editorMayEditUnpublished`): không có ma trận quyền thứ
   * hai, không so sánh vai trò rải rác ở từng lệnh con.
   */
  private assertChildEditAllowed(
    parent: ProjectScheduleState,
    actorRole?: string,
  ): void {
    assertContentEditAllowed(
      actorRole,
      editorMayEditProject(parent),
      CHILD_EDIT_DENIED_MESSAGE,
    );
  }

  /**
   * Tạo dự án mới — **luôn** ở trạng thái nháp, với MỌI vai trò.
   *
   * Trước batch này, SUPER_ADMIN tạo dự án là dự án ra công khai ngay
   * (`initialContentStatus`). Cách đó gộp **quyền được đăng** với **hành động
   * đăng**: chỉ bấm "Tạo dự án" là nội dung chưa ai đọc lại đã nằm trên
   * website. Nay việc công khai chỉ xảy ra qua lệnh tường minh
   * `PATCH /projects/:slug/status`. Quyền hạn KHÔNG đổi — SUPER_ADMIN vẫn đăng
   * thẳng `DRAFT → PUBLISHED` được ngay sau đó.
   *
   * Chỉ ảnh hưởng bản ghi TẠO MỚI từ đây trở đi; dữ liệu cũ giữ nguyên.
   */
  async create(dto: CreateProjectDto) {
    try {
      return await this.prisma.project.create({
        data: {
          ...dto,
          title: json(dto.title),
          summary: json(dto.summary),
          description: json(dto.description),
          location: json(dto.location),
          category: json(dto.category),
          highlights: json(dto.highlights),
          quickFacts: json(dto.quickFacts),
          gallerySections: json(dto.gallerySections),
          mapLocation: json(dto.mapLocation),
          // Ba cột xuất bản do SERVER đặt, ghi SAU `...dto` nên payload không
          // chèn được vào (`forbidNonWhitelisted` đã chặn từ tầng DTO). `status`
          // trong `...dto` là tình trạng thi công của dự án — chuyện khác hẳn,
          // người dùng vẫn tự đặt bình thường.
          //
          // Không mốc công khai, không lịch — dự án chưa từng hiển thị cho ai.
          // Đây chính là điều kiện để `schedulePublication` chấp nhận hẹn giờ.
          contentStatus: ContentStatus.DRAFT,
          publishedAt: null,
          scheduledAt: null,
        } satisfies Prisma.ProjectCreateInput,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`Slug "${dto.slug}" đã được dùng`);
      }
      throw error;
    }
  }

  /**
   * Sửa nội dung dự án.
   *
   * Thứ tự BẮT BUỘC: nạp bản ghi → chốt quyền theo `contentStatus` đã lưu → mới
   * ghi. EDITOR sửa được `DRAFT`/`PENDING`, không sửa được dự án đang hiển thị
   * công khai (`PUBLISHED`); ADMIN trở lên không đổi. Xem giới hạn đã biết của
   * ba module chưa có cột lịch sử xuất bản ở `editorMayEditUnpublished`.
   *
   * `status` (tình trạng thi công) vẫn sửa bình thường ở các trạng thái được
   * phép — nó không phải trạng thái xuất bản.
   */
  async update(slug: string, dto: UpdateProjectDto, actorRole?: string) {
    const project = await this.findBySlug(slug);
    assertContentEditAllowed(
      actorRole,
      editorMayEditProject(project),
      EDIT_DENIED_MESSAGE,
    );
    // Chuẩn hóa null → Prisma.DbNull TRƯỚC, rồi bọc chính giá trị đã chuẩn hóa
    // để giữ nguyên hành vi xóa field JSON (json() là identity lúc chạy).
    const data = normalizeJsonNulls(dto);
    try {
      return await this.prisma.project.update({
        where: { id: project.id },
        data: {
          ...data,
          title: json(data.title),
          summary: json(data.summary),
          description: json(data.description),
          location: json(data.location),
          category: json(data.category),
          highlights: json(data.highlights),
          quickFacts: json(data.quickFacts),
          gallerySections: json(data.gallerySections),
          mapLocation: json(data.mapLocation),
          // Lớp chốt thứ hai cho ba cột do SERVER sở hữu, đặt SAU `...data` nên
          // luôn thắng: sửa nội dung không bao giờ đổi trạng thái xuất bản hay
          // lịch đăng. `undefined` = Prisma giữ nguyên cột. DTO nội dung đã
          // không khai báo ba field này (`forbidNonWhitelisted` chặn ở tầng
          // ValidationPipe), nhưng phòng thủ không nên phụ thuộc vào việc một
          // DTO ở file khác mãi mãi giữ đúng hình dạng.
          contentStatus: undefined,
          publishedAt: undefined,
          scheduledAt: undefined,
        } satisfies Prisma.ProjectUpdateInput,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`Slug "${dto.slug}" đã được dùng`);
      }
      throw error;
    }
  }

  async updateStatus(slug: string, status: ContentStatus, actorRole?: string) {
    const project = await this.findBySlug(slug);
    // EDITOR chỉ được gửi duyệt (DRAFT → PENDING); ADMIN trở lên đặt tùy ý.
    assertContentStatusTransition(actorRole, project.contentStatus, status);
    const now = new Date();
    return this.prisma.project.update({
      where: { id: project.id },
      data: {
        contentStatus: status,
        publishedAt: this.publishedAtFor(project, status, now),
        scheduledAt: clearedSchedule(status),
      },
    });
  }

  /**
   * `publishedAt` cho một lần đổi trạng thái thủ công của dự án. Ba nhánh, khớp
   * từng ca với tin tức:
   *
   * - **Đăng ngay một dự án đang hẹn lịch chưa tới hạn.** Lệnh đặt lịch đã ghi
   *   `publishedAt = scheduledAt` ở **tương lai**. Giữ nguyên mốc đó thì dự án
   *   vừa bấm đăng lại mang mốc công khai nằm ở ngày mai. Bấm "Đăng ngay" nghĩa
   *   là công khai **bây giờ**, nên mốc phải là bây giờ — lần công khai theo lịch
   *   kia đã không xảy ra.
   * - **Đăng một dự án chưa từng có mốc nào** → `now`.
   * - **Đăng lại một dự án từng công khai thật** → giữ mốc lịch sử. `publishedAt`
   *   ở dự án này luôn có nghĩa **lần công khai ĐẦU TIÊN**.
   *
   * Với DRAFT: xoá `publishedAt` **chỉ khi** nó nằm ở tương lai — tức dự án chưa
   * từng công khai, mốc đó chỉ là ý định. Dự án đã thật sự công khai (kể cả dự án
   * tới hạn mà reconciler chưa chạm tới, vốn đã hiển thị qua vị từ hiển thị) giữ
   * nguyên mốc: nó **đã** ra ngoài, xoá đi là xoá mất sự thật đó.
   */
  private publishedAtFor(
    project: { publishedAt: Date | null },
    next: ContentStatus,
    now: Date,
  ): Date | null | undefined {
    if (next === ContentStatus.PUBLISHED) {
      return hasBeenPublic(project, now) ? project.publishedAt : now;
    }
    if (next === ContentStatus.DRAFT) {
      return hasBeenPublic(project, now) ? project.publishedAt : null;
    }
    // PENDING: không đụng tới mốc công khai.
    return project.publishedAt;
  }

  /**
   * Đặt (hoặc đổi) lịch đăng cho một dự án — lệnh riêng, chốt ADMIN+ ở controller.
   *
   * Ghi **nguyên tử ba cột** trong một câu UPDATE:
   *
   * ```
   * contentStatus = PENDING
   * scheduledAt   = mốc yêu cầu
   * publishedAt   = mốc yêu cầu      ← bất biến của lịch
   * ```
   *
   * Vì sao `publishedAt` ghi **ngay bây giờ** chứ không đợi reconciler: vị từ
   * hiển thị cho một dự án PENDING đã tới hạn ra công khai *trước khi* cron chạy.
   * Nếu lúc đó `publishedAt` còn NULL thì dự án xuất hiện thiếu mốc công khai và
   * sitemap không có `lastModified`. Mốc phải sẵn sàng từ trước thời điểm nội
   * dung có thể hiển thị.
   *
   * Vì sao trạng thái lưu là `PENDING` chứ không phải một enum `SCHEDULED` mới:
   * PENDING vừa đúng nghĩa (đã qua uỷ quyền của ADMIN, đang chờ), vừa **fail
   * safe** — mọi truy vấn cũ chỉ lọc `contentStatus = 'PUBLISHED'` mà ta lỡ bỏ
   * sót đều tự động giấu dự án này đi. Rủi ro của việc quên là "hiện muộn",
   * không phải "rò rỉ sớm".
   */
  async schedulePublication(slug: string, scheduledAtIso: string) {
    const project = await this.findBySlug(slug);
    // MỘT `now` cho cả kiểm tra lẫn ghi — dùng hai mốc khác nhau thì một lịch
    // sát ngưỡng có thể qua được validate rồi ghi xuống ở trạng thái không hợp lệ.
    const now = new Date();
    const scheduledAt = new Date(scheduledAtIso);

    if (project.contentStatus === ContentStatus.PUBLISHED) {
      // Không có versioning nội dung: một slug là một hàng, đang phục vụ một URL
      // công khai. Đặt lịch cho nó chỉ có hai cách hiểu, cả hai đều đánh lừa
      // người dùng — hoặc nội dung mới lên ngay lập tức (lịch vô nghĩa), hoặc
      // URL đang được index biến mất tới giờ hẹn.
      //
      // Nhánh này KHÔNG cần `publishedAt`, nên nó vẫn đúng với dữ liệu cũ tạo
      // trước khi hai cột mốc tồn tại: `contentStatus = PUBLISHED` một mình đã
      // chứng minh dự án đang công khai.
      throw new ConflictException(
        'Dự án đang được đăng công khai nên không đặt lịch được.',
      );
    }

    // Dự án TỪNG công khai thì không hẹn giờ lại được ở v1, kể cả khi đã gỡ về
    // nháp. Ghi lịch mới sẽ ghi đè `publishedAt` — mà mốc đó luôn có nghĩa là
    // **lần công khai ĐẦU TIÊN**. Ghi đè nó là âm thầm định nghĩa lại field
    // thành "lần đăng gần nhất". Đăng lại theo lịch là một nghiệp vụ khác, kéo
    // theo hàng loạt câu hỏi (thứ tự trang dự án, `lastModified` của sitemap,
    // mốc nào dùng cho xếp hạng) mà schema hiện không trả lời được.
    if (hasHistoricalPublication(project, now)) {
      throw new ConflictException(
        'Dự án này đã từng được đăng nên không đặt lịch đăng lại được.',
      );
    }

    // Ngưỡng tối thiểu 1 phút / tối đa 2 năm — dùng chung với tin tức.
    assertScheduleWindow(scheduledAt, now);

    return this.prisma.project.update({
      where: { id: project.id },
      data: {
        contentStatus: ContentStatus.PENDING,
        scheduledAt,
        publishedAt: scheduledAt,
      },
    });
  }

  /**
   * Huỷ lịch đăng — đưa dự án về trạng thái nháp sạch sẽ.
   *
   * **Chỉ áp dụng cho lịch CHƯA tới hạn.** Nếu `scheduledAt <= now` thì theo vị
   * từ hiển thị, dự án **đã đang hiển thị công khai** rồi, dù `contentStatus`
   * còn là PENDING vì reconciler chưa chạy. Lúc đó thao tác không còn là "huỷ
   * một việc chưa xảy ra" mà là **gỡ nội dung đang công khai** — một hành động
   * khác hẳn, đã có nút riêng ("Trả về nháp"), và có hệ quả khác với `publishedAt`.
   *
   * Trạng thái sau khi huỷ:
   * ```
   * contentStatus = DRAFT
   * scheduledAt   = NULL
   * publishedAt   = NULL     ← dự án chưa từng công khai nên mốc đó chỉ là ý định
   * ```
   *
   * Cố ý KHÔNG quay về "PENDING chưa hẹn giờ": v1 không có trạng thái "đã duyệt
   * nhưng chưa lên lịch", và thêm một enum như thế là đổi mô hình trạng thái.
   */
  async cancelScheduledPublication(slug: string) {
    const project = await this.findBySlug(slug);
    const now = new Date();

    if (project.scheduledAt === null) {
      throw new ConflictException('Dự án này không có lịch đăng nào.');
    }
    if (project.scheduledAt.getTime() <= now.getTime()) {
      throw new ConflictException(
        'Đã qua giờ đăng theo lịch nên dự án đang hiển thị công khai. Dùng "Trả về nháp" để gỡ dự án xuống.',
      );
    }
    // Còn lại: `scheduledAt` ở tương lai nhưng bản ghi KHÔNG phải một lịch hợp
    // lệ — dự án từng công khai và bị gán thêm lịch, hoặc tổ hợp dị dạng từ dữ
    // liệu cũ. Nhánh xoá bên dưới sẽ xoá `publishedAt`, mà ở đây mốc đó là lịch
    // sử thật. Từ chối thay vì xoá lịch sử.
    if (!isActiveFutureSchedule(project, now)) {
      throw new ConflictException(
        'Dự án này đã từng được đăng nên không huỷ lịch theo cách này được. Dùng "Trả về nháp" để gỡ dự án xuống.',
      );
    }

    return this.prisma.project.update({
      where: { id: project.id },
      data: {
        contentStatus: ContentStatus.DRAFT,
        scheduledAt: null,
        publishedAt: null,
      },
    });
  }

  async remove(slug: string) {
    const project = await this.findBySlug(slug);
    // Hạng mục và ảnh gallery xóa theo cascade (khai báo ở schema.prisma).
    await this.prisma.project.delete({ where: { id: project.id } });
    return { deleted: true };
  }

  /* ----------------------------- Hạng mục con ----------------------------- */

  async createItem(
    projectSlug: string,
    dto: CreateProjectItemDto,
    actorRole?: string,
  ) {
    const project = await this.findBySlug(projectSlug);
    this.assertChildEditAllowed(project, actorRole);
    try {
      return await this.prisma.projectItem.create({
        data: {
          ...dto,
          projectId: project.id,
          title: json(dto.title),
          summary: json(dto.summary),
          description: json(dto.description),
          highlights: json(dto.highlights),
          quickFacts: json(dto.quickFacts),
          gallerySections: json(dto.gallerySections),
        } satisfies Prisma.ProjectItemUncheckedCreateInput,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `Dự án này đã có hạng mục với slug "${dto.slug}"`,
        );
      }
      throw error;
    }
  }

  async updateItem(
    projectSlug: string,
    itemSlug: string,
    dto: UpdateProjectItemDto,
    actorRole?: string,
  ) {
    // Tra cứu TRƯỚC rồi mới chốt quyền: dự án hoặc hạng mục không tồn tại vẫn
    // trả 404 y như cũ, không biến thành 403 gây hiểu sai. Phép chốt vẫn nằm
    // trước câu ghi.
    const { project, item } = await this.findItemWithProject(
      projectSlug,
      itemSlug,
    );
    this.assertChildEditAllowed(project, actorRole);
    try {
      return await this.prisma.projectItem.update({
        where: { id: item.id },
        data: {
          ...dto,
          title: json(dto.title),
          summary: json(dto.summary),
          description: json(dto.description),
          highlights: json(dto.highlights),
          quickFacts: json(dto.quickFacts),
          gallerySections: json(dto.gallerySections),
        } satisfies Prisma.ProjectItemUpdateInput,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `Dự án này đã có hạng mục với slug "${dto.slug}"`,
        );
      }
      throw error;
    }
  }

  /**
   * Xóa hạng mục. Route đang chốt `@Roles(ADMIN, SUPER_ADMIN)` nên EDITOR không
   * tới được đây — phép chốt theo trạng thái cha vẫn đặt vào, để nếu sau này
   * route được mở cho EDITOR thì luật quản trị đã có sẵn, không phải nhớ thêm.
   */
  async removeItem(projectSlug: string, itemSlug: string, actorRole?: string) {
    const { project, item } = await this.findItemWithProject(
      projectSlug,
      itemSlug,
    );
    this.assertChildEditAllowed(project, actorRole);
    await this.prisma.projectItem.delete({ where: { id: item.id } });
    return { deleted: true };
  }

  /* ------------------------------- Thư viện ảnh ---------------------------- */

  async findGallery(projectSlug: string, publishedOnly = false) {
    const project = await this.findBySlug(projectSlug, publishedOnly);
    return this.prisma.projectGalleryImage.findMany({
      where: { projectId: project.id },
      orderBy: BY_ORDER,
    });
  }

  /**
   * Thêm một ảnh vào thư viện dự án. `itemSlug` gắn ảnh vào hạng mục con —
   * hạng mục phải thuộc đúng dự án này (findItemBySlug đã kiểm tra).
   */
  async addGalleryImage(
    projectSlug: string,
    dto: CreateGalleryImageDto,
    actorRole?: string,
  ) {
    const project = await this.findBySlug(projectSlug);
    this.assertChildEditAllowed(project, actorRole);
    const projectItemId = dto.itemSlug
      ? (await this.findItemBySlug(projectSlug, dto.itemSlug)).id
      : null;

    // Không truyền `order` thì xếp ảnh mới xuống cuối thư viện.
    const order = dto.order ?? (await this.nextGalleryOrder(project.id));

    return this.prisma.projectGalleryImage.create({
      data: {
        projectId: project.id,
        projectItemId,
        url: dto.url,
        caption: dto.caption as unknown as Prisma.InputJsonValue,
        order,
      },
    });
  }

  async updateGalleryImage(
    projectSlug: string,
    imageId: string,
    dto: UpdateGalleryImageDto,
    actorRole?: string,
  ) {
    const { project, image } = await this.findGalleryImage(
      projectSlug,
      imageId,
    );
    this.assertChildEditAllowed(project, actorRole);
    const projectItemId =
      dto.itemSlug === undefined
        ? undefined
        : dto.itemSlug === ''
          ? null // chuỗi rỗng = gỡ ảnh khỏi hạng mục, trả về cấp dự án
          : (await this.findItemBySlug(projectSlug, dto.itemSlug)).id;

    return this.prisma.projectGalleryImage.update({
      where: { id: image.id },
      data: {
        url: dto.url,
        caption: dto.caption as unknown as Prisma.InputJsonValue | undefined,
        order: dto.order,
        projectItemId,
      },
    });
  }

  async removeGalleryImage(
    projectSlug: string,
    imageId: string,
    actorRole?: string,
  ) {
    const { project, image } = await this.findGalleryImage(
      projectSlug,
      imageId,
    );
    this.assertChildEditAllowed(project, actorRole);
    await this.prisma.projectGalleryImage.delete({ where: { id: image.id } });
    return { deleted: true };
  }

  /**
   * Sắp xếp lại thư viện theo danh sách id truyền lên (kéo-thả ở Admin CMS).
   * Chạy trong transaction: thứ tự hiển thị không được rơi vào trạng thái nửa vời.
   */
  async reorderGallery(
    projectSlug: string,
    imageIds: string[],
    actorRole?: string,
  ) {
    const project = await this.findBySlug(projectSlug);
    // Sắp xếp lại thư viện ĐỔI nội dung công khai của dự án: thứ tự ảnh là thứ
    // tự hiển thị trên trang chi tiết, và ảnh đầu tiên là ảnh người xem thấy
    // trước. Nên nó chịu cùng luật với thêm/sửa/xóa ảnh.
    this.assertChildEditAllowed(project, actorRole);
    const owned = await this.prisma.projectGalleryImage.findMany({
      where: { projectId: project.id },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((image) => image.id));

    const unknownId = imageIds.find((id) => !ownedIds.has(id));
    if (unknownId) {
      throw new NotFoundException(
        `Ảnh ${unknownId} không thuộc dự án ${projectSlug}`,
      );
    }
    if (imageIds.length !== owned.length) {
      throw new ConflictException(
        `Cần đủ ${owned.length} ảnh của dự án để sắp xếp lại, nhận được ${imageIds.length}`,
      );
    }

    await this.prisma.$transaction(
      imageIds.map((id, order) =>
        this.prisma.projectGalleryImage.update({
          where: { id },
          data: { order },
        }),
      ),
    );
    return this.findGallery(projectSlug);
  }

  /**
   * Ảnh phải thuộc đúng dự án trên URL — chặn sửa/xóa chéo dự án.
   *
   * Trả **cả dự án cha**: các lệnh ghi cần `contentStatus` của cha để chốt quyền,
   * và cha đã được nạp ở đây rồi.
   */
  private async findGalleryImage(projectSlug: string, imageId: string) {
    const project = await this.findBySlug(projectSlug);
    const image = await this.prisma.projectGalleryImage.findFirst({
      where: { id: imageId, projectId: project.id },
    });
    if (!image) throw new NotFoundException('Không tìm thấy ảnh trong dự án');
    return { project, image };
  }

  private async nextGalleryOrder(projectId: string): Promise<number> {
    const last = await this.prisma.projectGalleryImage.findFirst({
      where: { projectId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return last ? last.order + 1 : 0;
  }
}
