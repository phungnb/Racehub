import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 005100: khuyến mãi vật phẩm (Xu)
const id = (n: number) => `00000000-0000-0000-0000-0000000051${String(n).padStart(2, '0')}`
const [ADM, A, B, C, NEWBIE] = [1, 2, 3, 4, 5].map(id)
const ALL = [ADM, A, B, C, NEWBIE]

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ${ALL.map((u, i) => `('${u}', 'ip${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${ALL.map((u, i) => `('${u}', 'P${i}', 0, 0, 10, now() - interval '${u === NEWBIE ? 1 : 60} days')`).join(', ')} on conflict do nothing;
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const bal = async (db: PGlite, u: string) => Number((await db.query<{ b: string }>(`select private.balance($1) as b`, [u])).rows[0].b)
const save = (db: PGlite, p: object) => rpc<Row>(db, ADM, `select public.admin_save_item_promotion($1::jsonb) as r`, [JSON.stringify(p)])
let k = 0
const key = () => `ip-test-${++k}-xxxx`

describe('khuyến mãi vật phẩm (005100)', () => {
  let db: PGlite
  let items: { code: string; price_xu: number }[]
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
    for (const u of [A, B, C, NEWBIE]) {
      await db.query(`select private.ledger_post('TEST_SEED', 'ip-seed-' || $1::text, 'seed', null,
        jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', 5000),
                          jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -5000)))`, [u])
    }
    items = (await db.query<{ code: string; price_xu: number }>(`select code, price_xu::int as price_xu from public.avatar_items
      where is_active and code is not null and price_xu >= 50 and unlock_level <= 10 and coalesce(metadata->>'acquire', '') <> 'shine' order by code`)).rows
  }, 300_000)

  it('SALE 30%: giá cuối hiện trong cửa hàng, mua trừ đúng giá, ghi nhận lượt; chồng chương trình / giảm sai bị chặn', async () => {
    const it0 = items[0]
    expect(await fails(rpc(db, A, `select public.admin_save_item_promotion($1::jsonb) as r`, [JSON.stringify({ kind: 'SALE' })]))).toContain('FORBIDDEN')
    expect(await fails(save(db, { kind: 'SALE', title: 'Giảm hết', item_type: 'AVATAR', item_code: it0.code, discount_pct: 100 }))).toContain('INVALID_DISCOUNT')
    expect(await fails(save(db, { kind: 'FLASH', title: 'Flash dài', item_type: 'AVATAR', item_code: it0.code, discount_pct: 40,
      ends_at: new Date(Date.now() + 5 * 86400_000).toISOString() }))).toContain('FLASH_TOO_LONG')
    await save(db, { kind: 'SALE', title: 'Giảm 30%', item_type: 'AVATAR', item_code: it0.code, discount_pct: 30 })
    expect(await fails(save(db, { kind: 'EVENT', title: 'Trùng', item_type: 'AVATAR', item_code: it0.code, discount_pct: 20 }))).toContain('PROMO_OVERLAP')
    const st = await rpc<Row>(db, A, `select public.character_state() as r`)
    const offer = st.items.find((x: Row) => x.code === it0.code).offer
    expect(offer).toMatchObject({ kind: 'SALE', price: Math.round(it0.price_xu * 0.7), eligible: true })
    const before = await bal(db, A)
    const r = await rpc<Row>(db, A, `select public.buy_avatar_item($1, $2) as r`, [it0.code, key()])
    expect(r.paid).toBe(Math.round(it0.price_xu * 0.7))
    expect(before - (await bal(db, A))).toBe(Math.round(it0.price_xu * 0.7))
  })

  it('LẦN ĐẦU chỉ cho người chưa từng mua; FLASH có số lượng thật, hết thì về giá gốc', async () => {
    const it1 = items[1], it2 = items[2]
    await save(db, { kind: 'FIRST_PURCHASE', title: 'Lần đầu -50%', item_type: 'AVATAR', item_code: it1.code, discount_pct: 50 })
    const offA = (await rpc<Row>(db, A, `select public.character_state() as r`)).items.find((x: Row) => x.code === it1.code).offer
    expect(offA.eligible).toBe(false)                                      // A đã mua ở bước trước
    const r = await rpc<Row>(db, B, `select public.buy_avatar_item($1, $2) as r`, [it1.code, key()])
    expect(r.paid).toBe(Math.round(it1.price_xu * 0.5))
    await save(db, { kind: 'FLASH', title: 'Flash 1 chiếc', item_type: 'AVATAR', item_code: it2.code, discount_pct: 40, quantity_limit: 1,
      ends_at: new Date(Date.now() + 6 * 3600_000).toISOString() })
    expect((await rpc<Row>(db, C, `select public.buy_avatar_item($1, $2) as r`, [it2.code, key()])).paid).toBe(Math.round(it2.price_xu * 0.6))
    expect((await rpc<Row>(db, B, `select public.buy_avatar_item($1, $2) as r`, [it2.code, key()])).paid).toBe(it2.price_xu)
  })

  it('quà MIỄN PHÍ / giảm giá: người nhận chỉ được Tỏa sáng theo Xu thực trả; hết lượt miễn phí thì trả giá gốc', async () => {
    const g = (await db.query<{ code: string; price_xu: number }>(`select code, price_xu from public.gift_catalog where is_active and vip_tier = 0 and season_from is null and price_xu = 100`)).rows[0]
    const g2 = (await db.query<{ code: string; price_xu: number }>(`select code, price_xu from public.gift_catalog where is_active and vip_tier = 0 and season_from is null and price_xu = 10`)).rows[0]
    expect(await fails(save(db, { kind: 'FREE', title: 'Tặng miễn phí', item_type: 'GIFT', item_code: g.code }))).toContain('FREE_NEEDS_LIMIT')
    await save(db, { kind: 'FREE', title: 'Tặng miễn phí', item_type: 'GIFT', item_code: g.code, per_user_limit: 1 })
    await save(db, { kind: 'SALE', title: 'Giảm 50%', item_type: 'GIFT', item_code: g2.code, discount_pct: 50 })
    const shine = async () => Number((await db.query<{ s: string }>(`select shine_total as s from public.profiles where id = $1`, [B])).rows[0].s)
    const s0 = await shine(), b0 = await bal(db, A)
    const send = (code: string) => rpc<Row>(db, A, `select public.send_gift($1, $2, 1, null, null, null, $3) as r`, [B, code, key()])
    expect((await send(g.code)).total_xu).toBe(0)
    expect(await shine()).toBe(s0)                                        // quà miễn phí: 0 Tỏa sáng
    expect((await send(g.code)).total_xu).toBe(100)                       // hết lượt miễn phí
    expect((await send(g2.code)).total_xu).toBe(5)
    expect(await shine()).toBe(s0 + 105)
    expect(b0 - (await bal(db, A))).toBe(105)
  })

  it('DÙNG THỬ: mặc được N ngày, mỗi người thử 1 lần, hết hạn tự tháo; GÓI: trừ giá gói, nhận đủ đồ, giới hạn lượt', async () => {
    const it3 = items[3]
    expect(await fails(save(db, { kind: 'TRIAL', title: 'Thử quà', item_type: 'GIFT', item_code: 'clap', trial_days: 3 }))).toContain('TRIAL_AVATAR_ONLY')
    await save(db, { kind: 'TRIAL', title: 'Mặc thử 3 ngày', item_type: 'AVATAR', item_code: it3.code, trial_days: 3 })
    const t = await rpc<Row>(db, C, `select public.try_avatar_item($1) as r`, [it3.code])
    expect(Date.parse(t.expires_at)).toBeGreaterThan(Date.now() + 2 * 86400_000)
    expect(await fails(rpc(db, C, `select public.try_avatar_item($1) as r`, [it3.code]))).toMatch(/ALREADY_OWNED|TRIAL_USED/)
    const slot = (await db.query<{ category: string; id: string }>(`select category, id from public.avatar_items where code = $1`, [it3.code])).rows[0]
    await db.query(`update public.user_equipment set ${slot.category}_item_id = $2 where user_id = $1`, [C, slot.id])
    await db.query(`update public.user_inventory set expires_at = now() - interval '1 minute' where user_id = $1 and item_id = $2`, [C, slot.id])
    const st = await rpc<Row>(db, C, `select public.character_state() as r`)
    expect(st.items.find((x: Row) => x.code === it3.code)).toMatchObject({ owned: false, trial_until: null })
    expect(st.equipped[slot.category]).not.toBe(it3.code)
    expect(await fails(rpc(db, C, `select public.try_avatar_item($1) as r`, [it3.code]))).toContain('TRIAL_USED')

    const pack = [items[4].code, items[5].code]
    const bundle = await save(db, { kind: 'BUNDLE', title: 'Gói khởi động', bundle_items: pack, fixed_price: 70, per_user_limit: 1 })
    const b0 = await bal(db, NEWBIE)
    expect(await rpc<Row>(db, NEWBIE, `select public.buy_item_bundle($1, $2) as r`, [bundle.id, key()])).toMatchObject({ items: 2, paid: 70 })
    expect(b0 - (await bal(db, NEWBIE))).toBe(70)
    expect(await fails(rpc(db, NEWBIE, `select public.buy_item_bundle($1, $2) as r`, [bundle.id, key()]))).toContain('PROMO_LIMIT_REACHED')
    const list = await rpc<Row>(db, ADM, `select public.admin_list_item_promotions() as r`)
    expect(list.promotions.find((p: Row) => p.id === bundle.id)).toMatchObject({ sold: 1, xu_paid: 70 })
  })
})
