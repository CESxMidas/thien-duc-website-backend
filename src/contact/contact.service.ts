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
    // client. Không `await` để email chậm (Resend/Render ngủ) không kéo dài `201`.
    void this.mail.sendContactNotification({
      submissionId: submission.id,
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
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { applicationCv: { select: { fileName: true, size: true } } },
    });
  }

  async findOne(id: string) {
    const submission = await this.prisma.contactSubmission.findUnique({
      where: { deletedAt: null, id },
      include: { applicationCv: { select: { fileName: true, size: true } } },
    });
    if (!submission)
      throw new NotFoundException('Không tìm thấy yêu cầu liên hệ');
    return submission;
  }

  async update(id: string, dto: UpdateContactSubmissionDto) {
    await this.findOne(id);
    return this.prisma.contactSubmission.update({ where: { id }, data: dto });
  }

  async downloadCv(id: string) {
    await this.findOne(id);
    const file = await this.prisma.applicationCv.findUnique({
      where: { submissionId: id },
    });
    if (!file) throw new NotFoundException('Hồ sơ không có file CV đính kèm.');
    return file;
  }
}
