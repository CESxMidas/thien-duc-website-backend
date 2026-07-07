import { Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';

@Injectable()
export class PagesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.page.findMany({ orderBy: { slug: 'asc' } });
  }

  async findBySlug(slug: string) {
    const page = await this.prisma.page.findUnique({ where: { slug } });
    if (!page) throw new NotFoundException('Không tìm thấy trang');
    return page;
  }

  create(dto: CreatePageDto) {
    return this.prisma.page.create({ data: dto as any });
  }

  async update(slug: string, dto: UpdatePageDto) {
    const page = await this.findBySlug(slug);
    return this.prisma.page.update({
      where: { id: page.id },
      data: dto as any,
    });
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
}
