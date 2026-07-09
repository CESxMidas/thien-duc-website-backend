import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from './cloudinary.service';
import { CreateMediaAssetDto } from './dto/create-media-asset.dto';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  findAll(folder?: string) {
    return this.prisma.mediaAsset.findMany({
      where: folder ? { folder: { startsWith: folder } } : undefined,
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

  async upload(
    file: Express.Multer.File,
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
    const asset = await this.findOne(id);

    if (asset.publicId && this.cloudinary.isConfigured) {
      try {
        await this.cloudinary.destroyImage(asset.publicId);
      } catch (error) {
        // Không xóa bản ghi DB khi ảnh vẫn còn trên cloud, tránh asset mồ côi
        // chiếm quota mà admin không còn thấy để dọn.
        this.logger.error(
          `Không xóa được ảnh ${asset.publicId} trên Cloudinary`,
          error instanceof Error ? error.stack : undefined,
        );
        throw new InternalServerErrorException(
          'Không xóa được ảnh trên Cloudinary, vui lòng thử lại',
        );
      }
    }

    await this.prisma.mediaAsset.delete({ where: { id } });
    return { deleted: true };
  }
}
