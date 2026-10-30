require('dotenv/config');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');

async function main() {
  const source = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(source.hostname));
  const database = `thien_duc_bulk_verify_${Date.now()}`;
  const adminUrl = new URL(source); adminUrl.pathname = '/postgres';
  const isolated = new URL(source); isolated.pathname = `/${database}`;
  const admin = new Client({ connectionString: adminUrl.href });
  await admin.connect();
  let created = false, sql, prisma;
  try {
    await admin.query(`CREATE DATABASE "${database}"`); created = true;
    sql = new Client({ connectionString: isolated.href }); await sql.connect();
    const dir = path.resolve('prisma/migrations');
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name, 'migration.sql');
      if (fs.existsSync(file)) await sql.query(fs.readFileSync(file, 'utf8'));
    }
    process.env.DATABASE_URL = isolated.href;
    const { PrismaService } = require('../dist/src/prisma/prisma.service');
    const { CmsTrashService } = require('../dist/src/cms-trash/cms-trash.service');
    prisma = new PrismaService(); await prisma.$connect();
    const service = new CmsTrashService(prisma);
    const superUser = await prisma.user.create({ data: { email: 'owner@bulk.e2e.test', name: 'Chủ kiểm thử', passwordHash: 'test-only', role: 'SUPER_ADMIN' } });
    const member = await prisma.user.create({ data: { email: 'member@bulk.e2e.test', name: 'Thành viên kiểm thử', passwordHash: 'test-only', role: 'EDITOR', canDeleteCms: true } });
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const row = await prisma.newsPost.create({ data: { slug: `bulk-${i}`, title: { vi: `Tin kiểm thử ${i}` }, content: [{ vi: 'Nội dung kiểm thử.' }] } }); ids.push(row.id);
    }
    let result = await service.bulkDelete('news', { ids: ids.slice(0, 2), mode: 'trash' }, member.id);
    assert.deepEqual(result.succeededIds, ids.slice(0, 2));
    assert.equal(await prisma.newsPost.count({ where: { id: { in: ids }, deletedAt: { not: null } } }), 2);
    await prisma.user.update({ where: { id: member.id }, data: { canDeleteCms: false } });
    await assert.rejects(() => service.bulkDelete('news', { ids: [ids[2]], mode: 'trash' }, member.id));
    result = await service.bulkDelete('news', { ids: [ids[2], randomUUID()], mode: 'permanent', confirm: true }, superUser.id);
    assert.deepEqual(result.succeededIds, [ids[2]]);
    assert.equal(result.failed[0].status, 404);
    assert.equal(await prisma.newsPost.count({ where: { id: ids[2] } }), 0);
    await assert.rejects(() => service.bulkDelete('news', { ids: ids.slice(0, 2), mode: 'permanent' }, superUser.id));
    result = await service.bulkDelete('news', { ids: ids.slice(0, 2), mode: 'permanent', confirm: true }, superUser.id);
    assert.deepEqual(result.succeededIds, ids.slice(0, 2));
    assert.equal(await prisma.newsPost.count(), 0);
    const project = await prisma.project.create({ data: { slug: 'bulk-parent', title: { vi: 'Dự án kiểm thử' }, summary: { vi: 'Tóm tắt' }, status: 'DANG_THI_CONG' } });
    await prisma.projectItem.create({ data: { projectId: project.id, slug: 'child', title: { vi: 'Hạng mục' } } });
    result = await service.bulkDelete('projects', { ids: [project.id], mode: 'permanent', confirm: true }, superUser.id);
    assert.deepEqual(result.succeededIds, [project.id]);
    assert.equal(await prisma.projectItem.count(), 0);
    result = await service.bulkDelete('users', { ids: [superUser.id], mode: 'permanent', confirm: true }, superUser.id);
    assert.equal(result.failed[0].status, 400);
    assert(await prisma.user.findUnique({ where: { id: superUser.id } }));
    console.log('PASS PostgreSQL cách ly: xóa nhiều vào thùng rác, quyền cấp/thu hồi, xác nhận vĩnh viễn, kết quả từng mục, cascade dự án và bảo vệ tài khoản bản thân.');
  } finally {
    if (prisma) await prisma.$disconnect();
    if (sql) await sql.end();
    if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.end();
    console.log('Đã dọn DB kiểm thử do phiên này tạo; không ghi DB dự án/production.');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
