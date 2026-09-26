import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 006400: Chợ BIB — không giữ tiền, không bán cao hơn giá gốc, liên hệ ẩn, runner đã xác minh mới đăng
const id = (n: number) => `00000000-0000-0000-0000-0000000064${String(n).padStart(2, '0')}`
const [SELLER, BUYER, NEWBIE, R1, R2, R3, ADM] = [1, 2, 3, 4, 5, 6, 7].map(id)

async function seed(db: PGlite) {
  const users = [SELLER, BUYER, NEWBIE, R1, R2, R3, ADM]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'b${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'Runner ${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const save = (db: PGlite, u: string, p: object) => rpc<string>(db, u, `select public.save_bib_listing($1::jsonb) as r`, [JSON.stringify(p)])
const list = (db: PGlite, u: string, p: object = {}) => rpc<Row>(db, u, `select public.bib_listings($1::jsonb) as r`, [JSON.stringify(p)])
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const BASE = { kind: 'SELL', race_name: 'Hà Nội Marathon 2026', race_date: future(30), city: 'Hà Nội', distance: '21K', original_price: 1_200_000, price: 1_000_000,
  transfer: 'OFFICIAL', contacts: { phone: '0912 345 678', zalo: '0912345678' } }

describe('Chợ BIB (006400)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
    for (const u of [SELLER, BUYER, R1, R2, R3]) {
      for (let k = 1; k <= 3; k++) await db.query(`
        insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
        values ($1, 'Chạy', 'STRAVA', now() - make_interval(days => $2::int), now() - make_interval(days => $2::int) + interval '40 minutes', 5000, 5000, 1800, 360, 'APPROVED', 'READY')`, [u, k])
    }
  }, 240_000)

  it('đăng tin: cần runner đã xác minh, giá ≤ giá gốc, có liên hệ, giải chưa diễn ra; tối đa 5 tin mở', async () => {
    expect(await fails(save(db, NEWBIE, BASE))).toContain('NOT_ELIGIBLE')
    expect(await fails(save(db, SELLER, { ...BASE, price: 1_500_000 }))).toContain('PRICE_ABOVE_ORIGINAL')
    expect(await fails(save(db, SELLER, { ...BASE, contacts: { phone: 'abc' } }))).toContain('CONTACT_REQUIRED')
    expect(await fails(save(db, SELLER, { ...BASE, race_date: '2020-01-01' }))).toContain('RACE_DATE_PAST')
    expect(await fails(save(db, SELLER, { ...BASE, note: 'Mua tại https://ve-re.vn' }))).toContain('NO_LINKS')
    const a = await save(db, SELLER, BASE)
    expect((await db.query<Row>(`select contacts from public.bib_listings where id = $1`, [a])).rows[0].contacts).toEqual({ phone: '0912345678', zalo: '0912345678' })
    await save(db, BUYER, { kind: 'BUY', race_name: 'VnExpress Marathon Huế', race_date: future(60), distance: '42K', contacts: { zalo: '0987654321' } })
    for (let i = 0; i < 4; i++) await save(db, SELLER, { ...BASE, race_name: `Giải số ${i}` })
    expect(await fails(save(db, SELLER, { ...BASE, race_name: 'Giải thứ 6' }))).toContain('TOO_MANY_LISTINGS')
  })

  it('danh sách ẩn liên hệ; xem liên hệ được ghi lại; lọc, tìm không dấu; trạng thái; báo cáo 3 lần → tạm ẩn; admin ẩn / hiện', async () => {
    const r = await list(db, BUYER, { q: 'ha noi marathon' })
    expect(r.total).toBe(1)
    const item = r.items[0]
    expect(item).toMatchObject({ race_name: 'Hà Nội Marathon 2026', price: 1_000_000, mine: false, revealed: false, seller: { runs: 3 } })
    expect(item.contacts).toBeUndefined()
    expect((await list(db, SELLER, { kind: 'BUY' })).items[0].contacts).toBeUndefined()
    expect(await rpc<Row>(db, BUYER, `select public.bib_contact($1) as r`, [item.id])).toEqual({ phone: '0912345678', zalo: '0912345678' })
    expect((await list(db, BUYER, { q: 'ha noi marathon' })).items[0]).toMatchObject({ revealed: true, contacts: { phone: '0912345678' } })
    expect((await list(db, SELLER, { mine: true })).items.find((x: Row) => x.id === item.id)).toMatchObject({ reveals: 1, contacts: { zalo: '0912345678' } })
    expect((await list(db, BUYER, { distance: '42K' })).total).toBe(1)
    expect(await fails(rpc(db, BUYER, `select public.set_bib_status($1, 'DONE')`, [item.id]))).toContain('LISTING_NOT_FOUND')
    await rpc(db, SELLER, `select public.set_bib_status($1, 'RESERVED')`, [item.id])
    expect((await list(db, BUYER, { q: 'ha noi marathon' })).items[0].status).toBe('RESERVED')
    expect(await fails(rpc(db, BUYER, `select * from public.bib_listings`))).toMatch(/permission|denied/i)

    for (const u of [R1, R2, R3]) await rpc(db, u, `select public.report_bib($1, 'FAKE', 'Nghi lừa đảo')`, [item.id])
    expect((await db.query<Row>(`select status from public.bib_listings where id = $1`, [item.id])).rows[0].status).toBe('HIDDEN')
    expect((await list(db, BUYER, { q: 'ha noi marathon' })).total).toBe(0)
    expect(await fails(rpc(db, SELLER, `select public.set_bib_status($1, 'OPEN')`, [item.id]))).toContain('LISTING_HIDDEN')
    expect(Number((await rpc<Row>(db, ADM, `select public.admin_inbox() as r`)).reports)).toBeGreaterThanOrEqual(1)
    expect(await fails(rpc(db, BUYER, `select public.admin_hide_bib($1, false)`, [item.id]))).toContain('FORBIDDEN')
    await rpc(db, ADM, `select public.admin_hide_bib($1, false)`, [item.id])
    expect((await list(db, BUYER, { q: 'ha noi marathon' })).total).toBe(1)
  })
})
