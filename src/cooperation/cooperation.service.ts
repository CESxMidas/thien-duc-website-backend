import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContentStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { json } from '../common/prisma-json';
import {
  assertContentStatusTransition,
  initialContentStatus,
} from '../common/content-approval';
import { CreateCooperationProjectDto } from './dto/create-cooperation-project.dto';
import { UpdateCooperationProjectDto } from './dto/update-cooperation-project.dto';

@Injectable()
export class CooperationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `publishedOnly` = true cho website công khai; false cho Admin CMS (thấy cả
   * bản nháp và chờ duyệt). `order` có thể trùng nhau nên chốt thêm createdAt để
   * thứ tự hiển thị ổn định giữa các lần gọi.
   */
  findAll(publishedOnly = false) {
    return this.prisma.cooperationProject.findMany({
      where: publishedOnly
        ? { contentStatus: ContentStatus.PUBLISHED }
        : undefined,
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(id: string) {
    const project = await this.prisma.cooperationProject.findUnique({
      where: { id },
    });
    if (!project) throw new NotFoundException('Không tìm thấy dự án hợp tác');
    return project;
  }

  create(dto: CreateCooperationProjectDto, actorRole?: string) {
    return this.prisma.cooperationProject.create({
      data: {
        ...dto,
        name: json(dto.name),
        location: json(dto.location),
        role: json(dto.role),
        partner: json(dto.partner),
        scale: json(dto.scale),
        status: json(dto.status),
        // `status` ở trên là trạng thái mô tả (chữ) của dự án; `contentStatus`
        // mới là bậc thang duyệt. SUPER_ADMIN xuất bản ngay; vai trò khác nháp.
        contentStatus: initialContentStatus(actorRole),
      } satisfies Prisma.CooperationProjectCreateInput,
    });
  }

  /**
   * Sửa NỘI DUNG — cố ý không đụng tới `contentStatus`.
   *
   * `...dto` được spread thẳng xuống Prisma, nên bất cứ field nào lọt vào DTO
   * cũng ghi được xuống DB. Đó chính là cách `contentStatus` từng biến route
   * này (mở cho EDITOR) thành đường đăng bài tắt, bỏ qua `updateStatus` và
   * `assertContentStatusTransition`. Chốt chặn nằm ở sự VẮNG MẶT của field
   * trong `CreateCooperationProjectDto` cộng `forbidNonWhitelisted`; khoá lại
   * bằng `cooperation-status-write-block.spec.ts`.
   *
   * Thêm field mới vào DTO nội dung thì cân nhắc: nó có phải thứ EDITOR được
   * phép tự quyết không? Trạng thái xuất bản thì KHÔNG.
   */
  async update(id: string, dto: UpdateCooperationProjectDto) {
    await this.findOne(id);
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
        // Lớp chốt thứ hai, đặt SAU `...dto` nên luôn thắng: sửa nội dung không
        // bao giờ đổi trạng thái xuất bản. `undefined` = Prisma giữ nguyên cột.
        // DTO đã không còn field này, nhưng phòng thủ không nên phụ thuộc vào
        // việc một DTO ở file khác mãi mãi giữ đúng hình dạng.
        contentStatus: undefined,
      } satisfies Prisma.CooperationProjectUpdateInput,
    });
  }

  async updateStatus(id: string, status: ContentStatus, actorRole?: string) {
    const project = await this.findOne(id);
    // EDITOR chỉ được gửi duyệt (DRAFT → PENDING); ADMIN trở lên đặt tùy ý.
    assertContentStatusTransition(actorRole, project.contentStatus, status);
    return this.prisma.cooperationProject.update({
      where: { id },
      data: { contentStatus: status },
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
   */
  async reorder(ids: string[]) {
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

    const found = await this.prisma.cooperationProject.count({
      where: { id: { in: ids } },
    });
    if (found !== ids.length) {
      throw new BadRequestException('Có id dự án hợp tác không tồn tại');
    }

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
