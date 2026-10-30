// Kiểm chứng SQL trong bảng tạm; không sửa dữ liệu đã lưu của môi trường chạy.
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');

async function main() {
  assert(['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname));
  const sql = await fs.readFile('prisma/migrations/20261030120000_update_company_office_address/migration.sql', 'utf8');
  const values = [...sql.matchAll(/'([^']*Trần Não[^']*)'/g)].map(match => match[1]);
  const nextVi = values[0], oldVi = values[1];
  const nextEn = '1D Tran Nao Street, Quarter 5, An Khanh Ward, Ho Chi Minh City 71322, Vietnam';
  const oldEn = 'No. 10 Tran Nao Street, Quarter 5, Binh Trung Ward, Ho Chi Minh City, Vietnam';
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE site_settings (key text, value jsonb, updated_at timestamp) ON COMMIT DROP');
    for (const [vi, en, expectedVi, expectedEn] of [
      [oldVi, oldEn, nextVi, nextEn],
      [oldVi, undefined, nextVi, nextEn],
      [oldVi, 'Custom English address', nextVi, 'Custom English address'],
      ['Custom office', oldEn, 'Custom office', oldEn],
      [nextVi, nextEn, nextVi, nextEn],
    ]) {
      await client.query('TRUNCATE pg_temp.site_settings');
      const contact = { phone: '0909 768 001', email: 'company@example.test', taxCode: '0309910290', address: { vi, ...(en ? { en } : {}) }, other: 'keep' };
      await client.query('INSERT INTO pg_temp.site_settings VALUES ($1,$2,NOW())', ['company-contact', contact]);
      await client.query(sql);
      await client.query(sql);
      const result = await client.query('SELECT value FROM pg_temp.site_settings');
      assert.deepEqual(result.rows[0].value, { ...contact, address: { vi: expectedVi, en: expectedEn } });
    }
    console.log('PASS: 5 trường hợp địa chỉ, giữ dữ liệu khác và chạy lại an toàn; chỉ dùng bảng tạm.');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
