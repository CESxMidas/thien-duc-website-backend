import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

@Injectable()
export class BannersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(activeOnly = false) {
    return this.prisma.banner.findMany({
      // `order` có thể trùng nhau (mặc định 0) nên chốt thêm createdAt để thứ tự
      // hiển thị ổn định giữa các lần gọi, tránh banner nhảy chỗ trên trang chủ.
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(id: string) {
    const banner = await this.prisma.banner.findUnique({ where: { id } });
    if (!banner) throw new NotFoundException('Không tìm thấy banner');
    return banner;
  }

  create(dto: CreateBannerDto) {
    return this.prisma.banner.create({
      data: dto as unknown as Prisma.BannerCreateInput,
    });
  }

  async update(id: string, dto: UpdateBannerDto) {
    await this.findOne(id);
    return this.prisma.banner.update({
      where: { id },
      data: dto as unknown as Prisma.BannerUpdateInput,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.banner.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Nhận toàn bộ id banner theo thứ tự mong muốn và ghi lại `order` (ED-06).
   * Bắt buộc gửi đủ danh sách: gửi thiếu sẽ để lại banner mang `order` cũ, xen
   * lẫn vào giữa dãy mới và làm thứ tự hiển thị sai.
   */
  async reorder(bannerIds: string[]) {
    const total = await this.prisma.banner.count();
    const unique = new Set(bannerIds);

    if (unique.size !== bannerIds.length) {
      throw new BadRequestException('Danh sách id banner bị trùng lặp');
    }
    if (bannerIds.length !== total) {
      throw new BadRequestException(
        `Phải gửi đủ ${total} banner, hiện nhận ${bannerIds.length}`,
      );
    }

    const found = await this.prisma.banner.count({
      where: { id: { in: bannerIds } },
    });
    if (found !== bannerIds.length) {
      throw new BadRequestException('Có id banner không tồn tại');
    }

    await this.prisma.$transaction(
      bannerIds.map((id, index) =>
        this.prisma.banner.update({ where: { id }, data: { order: index } }),
      ),
    );
    return this.findAll();
  }
}
