import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContentStatus } from '../../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { MulterFile } from '../media/types';
import { CreateJobApplicationDto } from './dto/create-job-application.dto';

export const MAX_CV_BYTES = 5 * 1024 * 1024;

@Injectable()
export class JobApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async create(
    positionId: string,
    dto: CreateJobApplicationDto,
    file?: MulterFile,
    ipAddress?: string,
  ) {
    if (dto.company) return { received: true };
    if (!file && !dto.cvLink)
      throw new BadRequestException('Cần tải file CV hoặc cung cấp link CV.');
    if (
      file &&
      (!file.size ||
        file.size > MAX_CV_BYTES ||
        file.buffer.length !== file.size ||
        !/\.pdf$/i.test(file.originalname) ||
        file.buffer.subarray(0, 5).toString() !== '%PDF-')
    ) {
      throw new BadRequestException(
        'CV phải là file PDF, dung lượng tối đa 5 MB.',
      );
    }
    if (dto.cvLink) {
      const url = new URL(dto.cvLink);
      if (url.protocol !== 'https:' || url.username || url.password)
        throw new BadRequestException(
          'Link CV phải dùng HTTPS và không chứa thông tin đăng nhập.',
        );
    }
    const today = new Date(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()) + 'T00:00:00.000Z',
    );
    const position = await this.prisma.recruitmentPosition.findFirst({
      where: {
        id: positionId,
        deletedAt: null,
        status: ContentStatus.PUBLISHED,
        OR: [{ deadline: null }, { deadline: { gte: today } }],
      },
    });
    if (!position)
      throw new NotFoundException(
        'Vị trí này đã ngừng nhận hồ sơ. Vui lòng chọn vị trí khác.',
      );
    const titles = position.title as { vi: string; en?: string };
    const title = (dto.locale === 'en' && titles.en) || titles.vi;
    const submission = await this.prisma.contactSubmission.create({
      data: {
        name: dto.name.trim(),
        phone: dto.phone,
        email: dto.email.trim(),
        inquiryType: 'tuyen-dung',
        applicationPositionId: position.id,
        applicationPositionTitle: title,
        applicationCvLink: dto.cvLink,
        message:
          dto.message?.trim() || 'Ứng viên không cung cấp thư giới thiệu.',
        ipAddress,
        ...(file
          ? {
              applicationCv: {
                create: {
                  fileName: file.originalname
                    .replace(/[^\p{L}\p{N} ._-]/gu, '_')
                    .slice(-160),
                  size: file.size,
                  content: new Uint8Array(file.buffer),
                },
              },
            }
          : {}),
      },
    });
    void this.mail.sendContactNotification({
      submissionId: submission.id,
      name: submission.name,
      phone: submission.phone,
      email: submission.email,
      inquiryType: submission.inquiryType,
      message: [
        `Vị trí ứng tuyển: ${title}`,
        submission.message,
        dto.cvLink ? `Link CV: ${dto.cvLink}` : undefined,
        file ? 'Có file CV đính kèm trong CMS.' : undefined,
      ]
        .filter(Boolean)
        .join('\n\n'),
      createdAt: submission.createdAt,
      ipAddress: submission.ipAddress,
    });
    return { id: submission.id, received: true };
  }
}
