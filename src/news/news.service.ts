import { Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNewsPostDto } from './dto/create-news-post.dto';
import { UpdateNewsPostDto } from './dto/update-news-post.dto';

@Injectable()
export class NewsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(publishedOnly = false) {
    return this.prisma.newsPost.findMany({
      where: publishedOnly ? { status: ContentStatus.PUBLISHED } : undefined,
      orderBy: { publishedAt: 'desc' },
      include: { category: true },
    });
  }

  async findBySlug(slug: string) {
    const post = await this.prisma.newsPost.findUnique({
      where: { slug },
      include: { category: true },
    });
    if (!post) throw new NotFoundException('Không tìm thấy bài viết');
    return post;
  }

  create(dto: CreateNewsPostDto) {
    const { eventDate, scheduledAt, ...rest } = dto;
    return this.prisma.newsPost.create({
      data: {
        ...rest,
        eventDate: eventDate ? new Date(eventDate) : undefined,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      } as any,
    });
  }

  async update(slug: string, dto: UpdateNewsPostDto) {
    const post = await this.findBySlug(slug);
    const { eventDate, scheduledAt, ...rest } = dto;
    return this.prisma.newsPost.update({
      where: { id: post.id },
      data: {
        ...rest,
        eventDate: eventDate ? new Date(eventDate) : undefined,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      } as any,
    });
  }

  async updateStatus(slug: string, status: ContentStatus) {
    const post = await this.findBySlug(slug);
    const publishedAt =
      status === ContentStatus.PUBLISHED ? new Date() : post.publishedAt;
    return this.prisma.newsPost.update({
      where: { id: post.id },
      data: { status, publishedAt },
    });
  }

  async remove(slug: string) {
    const post = await this.findBySlug(slug);
    await this.prisma.newsPost.delete({ where: { id: post.id } });
    return { deleted: true };
  }
}
