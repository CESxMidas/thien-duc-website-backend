import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  v2 as cloudinary,
  type UploadApiOptions,
  type UploadApiResponse,
} from 'cloudinary';
import { Readable } from 'node:stream';

/** Thư mục mặc định khi client không chỉ định. Cloud `thienduc` chỉ phục vụ
 * website này nên không cần thêm một cấp thư mục gốc mang tên công ty. */
export const DEFAULT_FOLDER = 'misc';

/** Ảnh xuất bản web: ≤ 1200px cạnh dài, WebP, chất lượng tự động (ED-05, mục 2.1.4). */
const DELIVERY_TRANSFORMATION: UploadApiOptions['transformation'] = [
  { width: 1200, height: 1200, crop: 'limit' },
  { quality: 'auto:good' },
  { fetch_format: 'webp' },
];

@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.config.get<string>('CLOUDINARY_API_SECRET');

    if (!cloudName || !apiKey || !apiSecret) {
      this.logger.warn(
        'Thiếu CLOUDINARY_* — endpoint upload sẽ trả 503 cho tới khi cấu hình đủ.',
      );
      return;
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
  }

  get isConfigured(): boolean {
    return Boolean(cloudinary.config().api_secret);
  }

  /**
   * Chuẩn hóa thư mục do client gửi lên. Chặn `..`, ký tự lạ và slash thừa để
   * không tạo ra đường dẫn ngoài ý muốn trên Cloudinary.
   */
  resolveFolder(folder?: string): string {
    if (!folder) return DEFAULT_FOLDER;
    const safe = folder
      .toLowerCase()
      .split('/')
      .map((segment) => segment.replace(/[^a-z0-9-]/g, ''))
      .filter(Boolean)
      .join('/');
    return safe || DEFAULT_FOLDER;
  }

  uploadImage(file: Express.Multer.File, folder: string) {
    return new Promise<UploadApiResponse>((resolve, reject) => {
      const upload = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          transformation: DELIVERY_TRANSFORMATION,
          // Cloudinary tự thêm hậu tố khi trùng tên, tránh ghi đè ảnh cũ.
          unique_filename: true,
          overwrite: false,
        },
        (error, result) => {
          if (error) return reject(new Error(error.message));
          if (!result) return reject(new Error('Cloudinary không trả kết quả'));
          resolve(result);
        },
      );
      Readable.from(file.buffer).pipe(upload);
    });
  }

  /**
   * Xóa ảnh trên Cloudinary. `publicId` phải là đường dẫn đầy đủ kể cả thư mục
   * (vd `thien-duc/projects/la-bonita/abc123`) — thiếu tiền tố thì Cloudinary
   * trả `not found` mà không báo lỗi, ảnh vẫn nằm lại và tiếp tục ăn quota.
   */
  async destroyImage(publicId: string): Promise<void> {
    const result: { result?: string } = await cloudinary.uploader.destroy(
      publicId,
      { resource_type: 'image', invalidate: true },
    );
    if (result.result !== 'ok' && result.result !== 'not found') {
      throw new Error(`Cloudinary destroy thất bại: ${result.result}`);
    }
  }
}
