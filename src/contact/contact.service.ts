import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContactSubmissionDto } from './dto/create-contact-submission.dto';
import { UpdateContactSubmissionDto } from './dto/update-contact-submission.dto';

@Injectable()
export class ContactService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateContactSubmissionDto, ipAddress?: string) {
    // TODO: gửi email thông báo qua SMTP thật khi có input câu 9 (docs/CAU-HOI-CAN-XAC-NHAN.md).
    return this.prisma.contactSubmission.create({
      data: { ...dto, ipAddress },
    });
  }

  findAll() {
    return this.prisma.contactSubmission.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const submission = await this.prisma.contactSubmission.findUnique({
      where: { id },
    });
    if (!submission)
      throw new NotFoundException('Không tìm thấy yêu cầu liên hệ');
    return submission;
  }

  async update(id: string, dto: UpdateContactSubmissionDto) {
    await this.findOne(id);
    return this.prisma.contactSubmission.update({ where: { id }, data: dto });
  }
}
