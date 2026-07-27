import { MailOutboxService } from './mail-outbox.service';

describe('MailOutboxService', () => {
  let outbox: MailOutboxService;

  beforeEach(() => {
    outbox = new MailOutboxService();
  });

  const base = {
    type: 'invitation' as const,
    to: 'a@test.local',
    subject: 'S',
    text: 'T',
    html: '<p>T</p>',
    url: 'http://localhost:5174/thiet-lap-tai-khoan?token=x',
  };

  it('record gán id + createdAt và giữ nguyên nội dung', () => {
    const saved = outbox.record(base);
    expect(saved.id).toMatch(/^outbox-\d+$/);
    expect(saved.createdAt).toBeDefined();
    expect(saved.to).toBe('a@test.local');
    expect(saved.url).toContain('token=');
  });

  it('list trả mới nhất trước', () => {
    outbox.record({ ...base, to: 'first@test.local' });
    outbox.record({ ...base, to: 'second@test.local' });
    const list = outbox.list();
    expect(list).toHaveLength(2);
    expect(list[0].to).toBe('second@test.local');
  });

  it('list lọc theo người nhận (không phân biệt hoa thường)', () => {
    outbox.record({ ...base, to: 'x@test.local' });
    outbox.record({ ...base, to: 'y@test.local' });
    const found = outbox.list('X@TEST.LOCAL');
    expect(found).toHaveLength(1);
    expect(found[0].to).toBe('x@test.local');
  });

  it('clear xóa sạch outbox', () => {
    outbox.record(base);
    outbox.record(base);
    outbox.clear();
    expect(outbox.list()).toHaveLength(0);
  });
});
