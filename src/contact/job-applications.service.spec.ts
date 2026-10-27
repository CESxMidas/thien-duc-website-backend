import {
  JobApplicationsService,
  MAX_CV_BYTES,
} from './job-applications.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import type { MulterFile } from '../media/types';

describe('Tiếp nhận hồ sơ ứng tuyển', () => {
  const dto = {
    name: 'Nguyễn Văn A',
    phone: '0901234567',
    email: 'a@example.com',
    locale: 'vi' as const,
  };
  const pdf = Buffer.from('%PDF-1.7\nCV\n%%EOF');
  const file: MulterFile = {
    fieldname: 'cv',
    originalname: 'CV.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    buffer: pdf,
    size: pdf.length,
  };
  const prisma = {
    recruitmentPosition: { findFirst: jest.fn() },
    contactSubmission: {
      create: jest.fn<
        Promise<Record<string, unknown>>,
        [{ data: Record<string, unknown> }]
      >(),
    },
  };
  const mail = {
    sendContactNotification: jest.fn().mockResolvedValue(undefined),
  };
  let service: JobApplicationsService;
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.recruitmentPosition.findFirst.mockResolvedValue({
      id: 'job1',
      title: { vi: 'Kỹ sư xây dựng', en: 'Engineer' },
    });
    prisma.contactSubmission.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...data, id: 'lead1', createdAt: new Date() }),
    );
    service = new JobApplicationsService(
      prisma as unknown as PrismaService,
      mail as unknown as MailService,
    );
  });
  it('lưu vị trí từ DB và file riêng trong cùng lệnh, chỉ trả xác nhận công khai', async () => {
    const result = await service.create('job1', dto, file, '127.0.0.1');
    expect(prisma.contactSubmission.create.mock.calls[0][0].data).toMatchObject(
      {
        applicationPositionId: 'job1',
        applicationPositionTitle: 'Kỹ sư xây dựng',
        inquiryType: 'tuyen-dung',
        applicationCv: {
          create: {
            fileName: 'CV.pdf',
            size: pdf.length,
            content: new Uint8Array(pdf),
          },
        },
      },
    );
    expect(result).toEqual({ id: 'lead1', received: true });
    expect(mail.sendContactNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Kỹ sư xây dựng') as unknown,
      }),
    );
  });
  it('cho phép chỉ dùng link CV và giữ tiếng Anh của vị trí', async () => {
    await service.create('job1', {
      ...dto,
      locale: 'en',
      cvLink: 'https://example.com/cv',
    });
    expect(prisma.contactSubmission.create.mock.calls[0][0].data).toMatchObject(
      {
        applicationPositionTitle: 'Engineer',
        applicationCvLink: 'https://example.com/cv',
      },
    );
    expect(
      prisma.contactSubmission.create.mock.calls[0][0].data.applicationCv,
    ).toBeUndefined();
  });
  it('cho phép đồng thời file và link', async () => {
    await expect(
      service.create(
        'job1',
        { ...dto, cvLink: 'https://example.com/cv' },
        file,
      ),
    ).resolves.toEqual({ id: 'lead1', received: true });
  });
  it('từ chối vị trí không tồn tại, bị ẩn, nháp hoặc đã quá hạn', async () => {
    prisma.recruitmentPosition.findFirst.mockResolvedValue(null);
    await expect(service.create('closed', dto, file)).rejects.toThrow(
      'ngừng nhận hồ sơ',
    );
    expect(prisma.recruitmentPosition.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'closed',
        deletedAt: null,
        status: 'PUBLISHED',
        OR: [
          { deadline: null },
          { deadline: { gte: expect.any(Date) as unknown } },
        ],
      },
    });
    expect(prisma.contactSubmission.create).not.toHaveBeenCalled();
  });
  it('không nhận hồ sơ thiếu cả hai nguồn CV', async () => {
    await expect(service.create('job1', dto)).rejects.toThrow(
      'Cần tải file CV',
    );
  });
  it.each([
    { ...file, originalname: 'CV.html' },
    { ...file, buffer: Buffer.from('<html>'), size: 6 },
    { ...file, buffer: Buffer.alloc(0), size: 0 },
    { ...file, size: MAX_CV_BYTES + 1 },
  ])('từ chối file giả dạng hoặc vượt giới hạn', async (invalid) => {
    await expect(service.create('job1', dto, invalid)).rejects.toThrow(
      'file PDF',
    );
    expect(prisma.contactSubmission.create).not.toHaveBeenCalled();
  });
  it('không nhận link chứa thông tin đăng nhập', async () => {
    await expect(
      service.create('job1', {
        ...dto,
        cvLink: 'https://a:secret@example.com/cv',
      }),
    ).rejects.toThrow('HTTPS');
  });
  it('honeypot không lưu DB và không gửi mail', async () => {
    await expect(
      service.create('job1', { ...dto, company: 'bot' }),
    ).resolves.toEqual({ received: true });
    expect(prisma.contactSubmission.create).not.toHaveBeenCalled();
    expect(mail.sendContactNotification).not.toHaveBeenCalled();
  });
});
