import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMediaAssetDto } from './dto/create-media-asset.dto';

@Injectable()
export class MediaService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.mediaAsset.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Không tìm thấy tệp tin');
    return asset;
  }

  // Ghi nhận metadata sau khi upload thành công lên Cloudinary (mục 2.1.4).
  // Chưa nối API upload thật vì tài khoản Cloudinary chưa được xác nhận (câu hỏi 12, CAU-HOI-CAN-XAC-NHAN.md).
  create(dto: CreateMediaAssetDto, uploadedById?: string) {
    return this.prisma.mediaAsset.create({ data: { ...dto, uploadedById } });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.mediaAsset.delete({ where: { id } });
    return { deleted: true };
  }
}
