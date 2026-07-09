import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContentStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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

  async create(dto: CreatePageDto) {
    try {
      return await this.prisma.page.create({
        data: dto as unknown as Prisma.PageCreateInput,
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
        data: dto as unknown as Prisma.PageUpdateInput,
      });
    } catch (error) {
      this.rethrowSlugConflict(error);
    }
  }

  async updateStatus(slug: string, status: ContentStatus) {
    const page = await this.findBySlug(slug);
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
