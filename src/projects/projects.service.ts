import { Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectItemDto } from './dto/create-project-item.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectItemDto } from './dto/update-project-item.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(publishedOnly = false) {
    return this.prisma.project.findMany({
      where: publishedOnly
        ? { contentStatus: ContentStatus.PUBLISHED }
        : undefined,
      orderBy: { order: 'asc' },
      include: { items: true },
    });
  }

  async findBySlug(slug: string) {
    const project = await this.prisma.project.findUnique({
      where: { slug },
      include: { items: true, galleryImages: true },
    });
    if (!project) throw new NotFoundException('Không tìm thấy dự án');
    return project;
  }

  async findItemBySlug(projectSlug: string, itemSlug: string) {
    const project = await this.findBySlug(projectSlug);
    const item = await this.prisma.projectItem.findFirst({
      where: { projectId: project.id, slug: itemSlug },
      include: { galleryImages: true },
    });
    if (!item) throw new NotFoundException('Không tìm thấy hạng mục dự án');
    return item;
  }

  create(dto: CreateProjectDto) {
    return this.prisma.project.create({
      data: dto as unknown as Prisma.ProjectCreateInput,
    });
  }

  async update(slug: string, dto: UpdateProjectDto) {
    const project = await this.findBySlug(slug);
    return this.prisma.project.update({
      where: { id: project.id },
      data: dto as unknown as Prisma.ProjectUpdateInput,
    });
  }

  async updateStatus(slug: string, status: ContentStatus) {
    const project = await this.findBySlug(slug);
    return this.prisma.project.update({
      where: { id: project.id },
      data: { contentStatus: status },
    });
  }

  async remove(slug: string) {
    const project = await this.findBySlug(slug);
    await this.prisma.project.delete({ where: { id: project.id } });
    return { deleted: true };
  }

  async createItem(projectSlug: string, dto: CreateProjectItemDto) {
    const project = await this.findBySlug(projectSlug);
    return this.prisma.projectItem.create({
      data: {
        ...dto,
        projectId: project.id,
      } as unknown as Prisma.ProjectItemUncheckedCreateInput,
    });
  }

  async updateItem(
    projectSlug: string,
    itemSlug: string,
    dto: UpdateProjectItemDto,
  ) {
    const item = await this.findItemBySlug(projectSlug, itemSlug);
    return this.prisma.projectItem.update({
      where: { id: item.id },
      data: dto as unknown as Prisma.ProjectItemUpdateInput,
    });
  }

  async removeItem(projectSlug: string, itemSlug: string) {
    const item = await this.findItemBySlug(projectSlug, itemSlug);
    await this.prisma.projectItem.delete({ where: { id: item.id } });
    return { deleted: true };
  }
}
