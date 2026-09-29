import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 011300: admin cũng là VĐV — nhận Xu từ chạy bộ và nạp tiền; chặn Xu tự cấp (khuyến mãi, cộng tay, giới thiệu, nhiệm vụ)
const ADM = '00000000-0000-0000-0000-0000001130a1'
async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${ADM}', 'a113@x.vn');
    insert into public.profiles (id, display_name) values ('${ADM}', 'Admin chạy bộ') on conflict do nothing;
    update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADM}';
  `)
}
const credit = (type: string, amt: number, key: string) => `select private.ledger_post('${type}', '${key}', 'test', null,
  jsonb_build_array(jsonb_build_object('account_id', '${ADM}'::uuid, 'coin_kind', 'BONUS', 'amount', ${amt}),
                    jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', ${-amt})))`
const bal = async (db: PGlite) => Number((await db.query<{ b: string }>(`select private.balance($1) b`, [ADM])).rows[0].b)

describe('admin cũng là VĐV (011300)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 300_000)

  it('nhận Xu chạy bộ, điểm danh, nạp tiền; không nhận khuyến mãi, cộng tay, giới thiệu, nhiệm vụ', async () => {
    await db.query(credit('RUN_REWARD', 12, 'k113-run'))
    await db.query(credit('XU_PURCHASE', 500, 'k113-buy'))
    await db.query(`select private.award($1, 'CHECKIN', 'Điểm danh', null, 1, 5, 'k113-checkin')`, [ADM])
    expect(await bal(db)).toBe(513)
    await db.query(credit('PROMO', 100, 'k113-promo'))
    await db.query(credit('ADMIN_GRANT', 100, 'k113-grant'))
    await db.query(credit('REFERRAL_INVITER', 20, 'k113-ref'))
    await db.query(`select private.award($1, 'QUEST', 'Nhiệm vụ', null, 30, 10, 'k113-quest')`, [ADM])
    expect(await bal(db)).toBe(513)
  })

  it('admin tự xác nhận nạp Xu cho chính mình: không in Xu', async () => {
    await db.query(`select private.ledger_post('XU_PURCHASE', 'k113-self', 'tự nạp', $1,
      jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'PAID', 'amount', 1000),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'PAID', 'amount', -1000)))`, [ADM])
    expect(await bal(db)).toBe(513)
    // Đơn của chính mình: không tự xác nhận được (cần admin khác)
    const pkg = (await db.query<{ id: string }>(`select id from public.xu_packages where active order by sort limit 1`)).rows[0].id
    const order = (await asUser<{ r: { id: string } }>(db, ADM, '/rpc', `select public.create_order($1::jsonb) as r`, [JSON.stringify({ kind: 'XU', package_id: pkg })])).rows[0].r
    const err = await asUser(db, ADM, '/rpc', `select public.admin_confirm_order($1)`, [order.id]).then(() => 'OK', (e: Error) => e.message)
    expect(err).toContain('SELF_CONFIRM_FORBIDDEN')
  })
})
