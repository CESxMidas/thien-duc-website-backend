import { Injectable, NotFoundException } from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContactSubmissionDto } from './dto/create-contact-submission.dto';
import { UpdateContactSubmissionDto } from './dto/update-contact-submission.dto';

@Injectable()
export class ContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async create(dto: CreateContactSubmissionDto, ipAddress?: string) {
    // Lưu lead trước — đây là dữ liệu bắt buộc không được để mất.
    const submission = await this.prisma.contactSubmission.create({
      data: { ...dto, ipAddress },
    });

    // Gửi email thông báo KHÔNG chặn response: lead đã lưu, `sendContact-
    // Notification` tự nuốt lỗi nên lượt gửi hỏng cũng không ảnh hưởng tới
    // client. Không `await` để SMTP chậm (Yahoo/Render ngủ) không kéo dài `201`.
    void this.mail.sendContactNotification({
      name: submission.name,
      phone: submission.phone,
      email: submission.email,
      inquiryType: submission.inquiryType,
      message: submission.message,
      ipAddress: submission.ipAddress,
      createdAt: submission.createdAt,
    });

    return submission;
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
