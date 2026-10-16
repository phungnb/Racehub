import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 017400: ly cà phê ủng hộ admin (lời nhắn + QR + tài khoản ngân hàng)
const [ADMIN, U] = ['00000000-0000-0000-0000-0000000074a1', '00000000-0000-0000-0000-0000000074a2']

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'a@x.vn'), ('${U}', 'u@x.vn');
    insert into public.profiles (id, display_name, created_at) values ('${ADMIN}', 'A', now()), ('${U}', 'U', now());
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string | null, sql: string, params: unknown[] = []) =>
  (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r

describe('Ly cà phê ủng hộ (017400)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADMIN])
  }, 300_000)

  const qr = 'https://x.supabase.co/storage/v1/object/public/support-media/qr-1.png'
  it('chưa cấu hình thì người dùng không thấy gì; chỉ admin sửa được', async () => {
    expect(await rpc(db, U, `select public.support_coffee() as r`)).toBeNull()
    await expect(asUser(db, U, '/rpc', `select public.admin_set_support_coffee($1)`, [{ message: 'hi' }])).rejects.toThrow(/FORBIDDEN/)
  })

  it('admin lưu → người dùng đọc được; tắt thì ẩn; từ chối ảnh ngoài kho', async () => {
    await rpc(db, ADMIN, `select public.admin_set_support_coffee($1) as r`,
      [{ enabled: true, message: 'Ủng hộ admin ly cà phê', qr_url: qr, bank_name: 'VCB', account_number: '0123456789', account_name: 'NGUYEN VAN A' }])
    expect(await rpc(db, U, `select public.support_coffee() as r`)).toMatchObject({ message: 'Ủng hộ admin ly cà phê', qr_url: qr, account_number: '0123456789' })
    await expect(asUser(db, ADMIN, '/rpc', `select public.admin_set_support_coffee($1)`, [{ qr_url: 'https://evil.com/a.png' }])).rejects.toThrow(/INVALID_QR/)
    await rpc(db, ADMIN, `select public.admin_set_support_coffee($1) as r`, [{ enabled: false, message: 'x', qr_url: qr }])
    expect(await rpc(db, U, `select public.support_coffee() as r`)).toBeNull()
    expect(await rpc(db, ADMIN, `select public.admin_get_support_coffee() as r`)).toMatchObject({ enabled: false })
  })
})
