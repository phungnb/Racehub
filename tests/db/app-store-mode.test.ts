import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 011100: công tắc "Cho phép mua trong app iOS/Android" (mặc định tắt) + Zalo / Telegram hỗ trợ
const [U, ADM] = ['00000000-0000-0000-0000-0000001111a1', '00000000-0000-0000-0000-0000001111a2']
async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${U}', 'u111@x.vn'), ('${ADM}', 'a111@x.vn');
    insert into public.profiles (id, display_name) values ('${U}', 'U'), ('${ADM}', 'A') on conflict do nothing;
    update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADM}';
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string | null, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r as T

describe('chế độ app cửa hàng (011100)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 300_000)

  it('mua trong app mặc định tắt; admin bật được; các tính năng khác vẫn bật', async () => {
    const pub = await rpc(db, null, `select public.ops_policy() as r`)
    expect(pub.features).toMatchObject({ nativePurchases: false, nearby: true, orgs: true })
    await rpc(db, ADM, `select public.admin_publish_ops_policy($1::jsonb) as r`, [JSON.stringify({ features: { nativePurchases: true } })])
    expect((await rpc(db, U, `select public.ops_policy() as r`)).features).toMatchObject({ nativePurchases: true, nearby: true })
  })

  it('thông tin công ty nhận Zalo, Telegram; ai cũng đọc được qua menu', async () => {
    await rpc(db, ADM, `select public.admin_site_info_save($1::jsonb) as r`,
      [JSON.stringify({ support_zalo: '0909123456', support_telegram: '@racehub_vn', support_email: 'hotro@racehub.vn', la: 'bỏ' })])
    const menu = await rpc(db, null, `select public.help_menu() as r`)
    expect(menu.site).toEqual({ support_zalo: '0909123456', support_telegram: '@racehub_vn', support_email: 'hotro@racehub.vn' })
  })
})
