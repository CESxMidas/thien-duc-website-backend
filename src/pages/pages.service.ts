import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContentStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { json } from '../common/prisma-json';
import { assertContentStatusTransition } from '../common/content-approval';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';

const UNIQUE_CONSTRAINT = 'P2002';

@Injectable()
export class PagesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(publishedOnly = false) {
    return this.prisma.page.findMany({
      where: publishedOnly ? { status: ContentStatus.PUBLISHED } : undefined,
      orderBy: { slug: 'asc' },
    });
  }

  /**
   * `publishedOnly` bắt buộc bật ở route công khai — nếu không, trang nháp và
   * trang chờ duyệt sẽ đọc được từ bên ngoài chỉ bằng cách đoán slug.
   */
  async findBySlug(slug: string, publishedOnly = false) {
    const page = await this.prisma.page.findUnique({ where: { slug } });
    if (!page || (publishedOnly && page.status !== ContentStatus.PUBLISHED)) {
      throw new NotFoundException('Không tìm thấy trang');
    }
    return page;
  }

  /**
   * Tạo trang mới — **luôn** ở trạng thái nháp, với MỌI vai trò.
   *
   * Trước batch này SUPER_ADMIN tạo trang là trang lên website ngay. Với trang
   * nội dung thì điều đó còn khó chịu hơn tin tức: trang mới thường được dựng
   * dần qua nhiều lần lưu, mà mỗi lần lưu đầu tiên đã là một URL công khai còn
   * dở dang. Nay công khai đi qua lệnh riêng `PATCH /pages/:slug/status`.
   * Quyền hạn KHÔNG đổi.
   */
  async create(dto: CreatePageDto) {
    try {
      return await this.prisma.page.create({
        data: {
          ...dto,
          title: json(dto.title),
          content: json(dto.content),
          // Trạng thái xuất bản do SERVER đặt, ghi SAU `...dto`. DTO nội dung
          // không khai báo `status` nên `forbidNonWhitelisted` đã chặn từ tầng
          // ValidationPipe; dòng này là lớp chốt thứ hai.
          status: ContentStatus.DRAFT,
        } satisfies Prisma.PageCreateInput,
      });
    } catch (error) {
      this.rethrowSlugConflict(error);
    }
  }

  async update(slug: string, dto: UpdatePageDto) {
    const page = await this.findBySlug(slug);
    try {
      return await this.prisma.page.update({
        where: { id: page.id },
        data: {
          ...dto,
          title: json(dto.title),
          content: json(dto.content),
        } satisfies Prisma.PageUpdateInput,
      });
    } catch (error) {
      this.rethrowSlugConflict(error);
    }
  }

  async updateStatus(slug: string, status: ContentStatus, actorRole?: string) {
    const page = await this.findBySlug(slug);
    // EDITOR chỉ được gửi duyệt (DRAFT → PENDING); ADMIN trở lên đặt tùy ý.
    assertContentStatusTransition(actorRole, page.status, status);
    return this.prisma.page.update({
      where: { id: page.id },
      data: { status },
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
