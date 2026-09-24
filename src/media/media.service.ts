import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { MulterFile } from './types';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from './cloudinary.service';
import { CreateMediaAssetDto } from './dto/create-media-asset.dto';
import { UpdateMediaAssetDto } from './dto/update-media-asset.dto';

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  findAll(folder?: string, includeInactive = false) {
    return this.prisma.mediaAsset.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(folder ? { folder: { startsWith: folder } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Không tìm thấy tệp tin');
    return asset;
  }

  /** Ghi nhận metadata của ảnh đã có sẵn URL (không đi qua Cloudinary). */
  create(dto: CreateMediaAssetDto, uploadedById?: string) {
    return this.prisma.mediaAsset.create({ data: { ...dto, uploadedById } });
  }

  async update(id: string, dto: UpdateMediaAssetDto) {
    await this.findOne(id);
    return this.prisma.mediaAsset.update({ where: { id }, data: dto });
  }

  async upload(
    file: MulterFile,
    subFolder: string | undefined,
    uploadedById?: string,
  ) {
    if (!this.cloudinary.isConfigured) {
      throw new ServiceUnavailableException(
        'Chưa cấu hình Cloudinary trên máy chủ',
      );
    }

    const folder = this.cloudinary.resolveFolder(subFolder);
    const result = await this.cloudinary.uploadImage(file, folder);

    return this.prisma.mediaAsset.create({
      data: {
        url: result.secure_url,
        // public_id của Cloudinary đã bao gồm đường dẫn thư mục — lưu nguyên vẹn
        // để lệnh xóa sau này tìm đúng ảnh.
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        format: result.format,
        bytes: result.bytes,
        folder,
        uploadedById,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.mediaAsset.update({
      where: { id },
      data: { isActive: false },
    });
    return { hidden: true };
  }
}
