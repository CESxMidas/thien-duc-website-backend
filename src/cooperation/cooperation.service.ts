import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContentStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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

  create(dto: CreateCooperationProjectDto) {
    return this.prisma.cooperationProject.create({
      data: dto as unknown as Prisma.CooperationProjectCreateInput,
    });
  }

  async update(id: string, dto: UpdateCooperationProjectDto) {
    await this.findOne(id);
    return this.prisma.cooperationProject.update({
      where: { id },
      data: dto as unknown as Prisma.CooperationProjectUpdateInput,
    });
  }

  async updateStatus(id: string, status: ContentStatus) {
    await this.findOne(id);
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
