import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 003800: gói VIP / CLB Pro, lượt tạo hằng tháng, đơn hàng VietQR, nạp Xu, quyền tổ chức giải chạy ảo
const id = (n: number) => `00000000-0000-0000-0000-0000000038${String(n).padStart(2, '0')}`
const [U, V, OWNER, MEMBER, ADMIN] = [1, 2, 3, 4, 5].map(id)
const CLUB = '00000000-0000-0000-0000-0000000038c1'

async function seed(db: PGlite) {
  const all = [U, V, OWNER, MEMBER, ADMIN]
  await db.exec(`
    insert into auth.users (id, email) values ${all.map((u, i) => `('${u}', 'p${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ${all.map((u, i) => `('${u}', 'P${i}', 0, 0, 1, now())`).join(', ')};
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'NBNR', '${OWNER}', 'plan0001');
    insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${OWNER}', 'OWNER', 'APPROVED'), ('${CLUB}', '${MEMBER}', 'MEMBER', 'APPROVED');
  `)
}

type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const xu = async (db: PGlite, acc: string, kind: string | null = null) => Number((await db.query<{ b: string }>(`select private.balance($1, $2) as b`, [acc, kind])).rows[0].b)
const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

describe('Gói, lượt tạo, đơn hàng (003800)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADMIN])
  }, 300_000)

  it('bảng giá mặc định theo đặc tả; admin sửa giá / lượt tạo; người thường không sửa được', async () => {
    const cat = await rpc<Row>(db, U, `select public.pricing_catalog() as r`)
    const vip2 = cat.plans.find((p: Row) => p.code === 'VIP2')
    expect(vip2.prices).toEqual([{ months: 1, price_vnd: 59000, active: true }, { months: 12, price_vnd: 599000, active: true }])
    expect(vip2.credits).toEqual([{ capacity: 50, per_month: 2 }, { capacity: 100, per_month: 2 }, { capacity: 200, per_month: 1 }])
    expect(cat.plans.find((p: Row) => p.code === 'CLUB_PRO').prices.map((x: Row) => x.price_vnd)).toEqual([129000, 349000, 649000, 999000])
    expect(cat.packages.length).toBeGreaterThan(0)
    expect(await fails(rpc(db, U, `select public.admin_save_plan($1::jsonb)`, [JSON.stringify({ code: 'VIP1', prices: [{ months: 1, price_vnd: 1 }] })]))).toMatch(/FORBIDDEN/)
    await rpc(db, ADMIN, `select public.admin_save_plan($1::jsonb)`, [JSON.stringify({ code: 'VIP1', prices: [{ months: 1, price_vnd: 25000 }] })])
    expect((await rpc<Row>(db, U, `select public.pricing_catalog() as r`)).plans.find((p: Row) => p.code === 'VIP1').prices[0].price_vnd).toBe(25000)
  })

  it('mua VIP2 qua đơn hàng: tạo đơn (mã RH…), admin đặt tài khoản nhận tiền + xác nhận → kích hoạt, cấp lượt tạo tháng này', async () => {
    await rpc(db, ADMIN, `select public.admin_set_payment_account('970436', '0123456789', 'Cong ty RaceHub')`)
    const o = await rpc<Row>(db, U, `select public.create_order($1::jsonb) as r`, [JSON.stringify({ kind: 'PLAN', plan_code: 'VIP2', months: 12 })])
    expect(o).toMatchObject({ status: 'PENDING', amount_vnd: 599000, owner_type: 'USER', owner_id: U })
    expect(o.code).toMatch(/^RH\d+$/)
    expect(o.payment).toMatchObject({ bank_bin: '970436', account_no: '0123456789', account_name: 'CONG TY RACEHUB' })
    expect((await rpc<Row>(db, U, `select public.my_plan() as r`)).plan).toBeNull()
    expect(await fails(rpc(db, U, `select public.admin_confirm_order($1)`, [o.id]))).toMatch(/FORBIDDEN/)
    await rpc(db, ADMIN, `select public.admin_confirm_order($1)`, [o.id])
    await rpc(db, ADMIN, `select public.admin_confirm_order($1)`, [o.id])            // bấm 2 lần không kích hoạt 2 lần
    const mine = await rpc<Row>(db, U, `select public.my_plan() as r`)
    expect(mine.plan).toMatchObject({ plan_code: 'VIP2', tier: 2 })
    expect(mine.credits.map((c: Row) => [c.capacity, c.remaining])).toEqual([[50, 2], [100, 2], [200, 1]])
    expect((await db.query(`select 1 from public.subscriptions where owner_id = $1`, [U])).rows).toHaveLength(1)
    // gọi lại không cấp trùng
    await rpc(db, U, `select public.my_plan() as r`)
    expect((await db.query(`select 1 from public.challenge_passes where owner_id = $1`, [U])).rows).toHaveLength(3)
  })

  it('lượt tạo dùng trước Xu; hết lượt mức đó thì trả Xu; lượt lớn dùng được cho thử thách nhỏ (không tách nhỏ)', async () => {
    const create = (p: Row, key: string) => rpc<Row>(db, U, `select public.create_challenge_v2($1::jsonb, $2) as r`, [JSON.stringify(p), key])
    const base = { format: 'RANKED', start_date: iso(1), end_date: iso(72) }
    const r1 = await create({ ...base, title: 'Dùng lượt 50', max_slots: 40 }, 'pl-ch-0001')
    expect(r1).toMatchObject({ fee: 0, pass_used: true })
    await create({ ...base, title: 'Dùng lượt 50 (2)', max_slots: 50 }, 'pl-ch-0002')
    const q = await rpc<Row>(db, U, `select public.quote_capacity(50) as r`)
    expect(q.pass).toMatchObject({ max_slots: 100 })                                   // hết lượt ≤50 → dùng lượt ≤100
    expect(q).toMatchObject({ fee: 400, payer: 'USER' })
  })

  it('CLB Pro: chỉ ban quản trị mua; kích hoạt cập nhật CLB + 2 lượt ≤100 / tháng; thử thách CLB dùng lượt CLB', async () => {
    expect(await fails(rpc(db, MEMBER, `select public.create_order($1::jsonb)`, [JSON.stringify({ kind: 'PLAN', plan_code: 'CLUB_PRO', months: 3, club_id: CLUB })])))
      .toContain('CLUB_STAFF_REQUIRED')
    const o = await rpc<Row>(db, OWNER, `select public.create_order($1::jsonb) as r`, [JSON.stringify({ kind: 'PLAN', plan_code: 'CLUB_PRO', months: 3, club_id: CLUB })])
    expect(o.amount_vnd).toBe(349000)
    await rpc(db, ADMIN, `select public.admin_confirm_order($1)`, [o.id])
    const club = (await db.query<{ plan: string; pro_until: string }>(`select plan, pro_until from public.clubs where id = $1`, [CLUB])).rows[0]
    expect(club.plan).toBe('PRO')
    expect(Date.parse(club.pro_until)).toBeGreaterThan(Date.now() + 80 * 86400_000)
    const st = await rpc<Row>(db, MEMBER, `select public.club_plan_status($1) as r`, [CLUB])
    expect(st.credits.map((c: Row) => [c.capacity, c.remaining])).toEqual([[100, 2]])
    const r = await rpc<Row>(db, OWNER, `select public.create_challenge_v2($1::jsonb, 'pl-club-001') as r`,
      [JSON.stringify({ title: 'Tháng NBNR', format: 'RANKED', audience: 'CLUB_ONLY', club_id: CLUB, max_slots: 100, start_date: iso(1), end_date: iso(72) })])
    // 008200: thử thách nội bộ CLB Pro miễn phí trong hạn mức gói → giữ nguyên lượt tạo
    expect(r).toMatchObject({ fee: 0, pass_used: false, club_free: 'PRO' })
    expect((await rpc<Row>(db, MEMBER, `select public.club_plan_status($1) as r`, [CLUB])).credits[0].remaining).toBe(2)
  })

  it('nạp Xu: đơn gói Xu, admin xác nhận → Xu nạp (PAID) + Xu tặng thêm (BONUS); hủy đơn chờ', async () => {
    const pkg = (await rpc<Row>(db, V, `select public.pricing_catalog() as r`)).packages.find((p: Row) => p.xu === 1000)
    const o = await rpc<Row>(db, V, `select public.create_order($1::jsonb) as r`, [JSON.stringify({ kind: 'XU', package_id: pkg.id })])
    expect(o).toMatchObject({ amount_vnd: 100000, xu: 1000, bonus_xu: 80 })
    await rpc(db, ADMIN, `select public.admin_confirm_order($1, 'Đã nhận CK')`, [o.id])
    expect(await xu(db, V, 'PAID')).toBe(1000)
    expect(await xu(db, V, 'BONUS')).toBe(80)
    const o2 = await rpc<Row>(db, V, `select public.create_order($1::jsonb) as r`, [JSON.stringify({ kind: 'XU', package_id: pkg.id })])
    expect((await rpc<Row>(db, V, `select public.cancel_order($1) as r`, [o2.id])).status).toBe('CANCELLED')
    expect(await fails(rpc(db, ADMIN, `select public.admin_confirm_order($1)`, [o2.id]))).toContain('ORDER_NOT_PENDING')
  })

  it('admin cấp gói tay (có lý do, nối tiếp hạn cũ)', async () => {
    expect(await fails(rpc(db, ADMIN, `select public.admin_grant_plan('USER', $1, 'VIP1', 1, '')`, [V]))).toContain('REASON_REQUIRED')
    const s1 = await rpc<Row>(db, ADMIN, `select public.admin_grant_plan('USER', $1, 'VIP1', 1, 'Tặng thử') as r`, [V])
    const s2 = await rpc<Row>(db, ADMIN, `select public.admin_grant_plan('USER', $1, 'VIP1', 1, 'Tặng thêm') as r`, [V])
    expect(s2.starts_at).toBe(s1.ends_at)
  })

  it('giải chạy ảo: cần admin cấp quyền (CLB hoặc cá nhân); thu phí theo quy mô bằng ví CLB', async () => {
    const body = (extra: Row) => JSON.stringify({ title: 'Giải NBNR', distances: [5, 10], start_at: iso(24), end_at: iso(24 * 10), ...extra })
    expect(await fails(rpc(db, OWNER, `select public.create_virtual_race($1::jsonb) as r`, [body({ club_id: CLUB, max_participants: 300 })]))).toContain('RACE_ORGANIZER_REQUIRED')
    expect(await fails(rpc(db, V, `select public.create_virtual_race($1::jsonb) as r`, [body({ max_participants: 50 })]))).toContain('RACE_ORGANIZER_REQUIRED')
    await rpc(db, ADMIN, `select public.admin_set_race_organizer('CLUB', $1, true, 'CLB uy tín')`, [CLUB])
    expect((await rpc<Row>(db, OWNER, `select public.can_organize_race() as r`)).clubs).toEqual([CLUB])
    expect(await fails(rpc(db, OWNER, `select public.create_virtual_race($1::jsonb) as r`, [body({ club_id: CLUB })]))).toContain('CAPACITY_REQUIRED')
    expect(await fails(rpc(db, OWNER, `select public.create_virtual_race($1::jsonb) as r`, [body({ club_id: CLUB, max_participants: 300 })]))).toContain('INSUFFICIENT_TREASURY')
    await db.query(`select private.ledger_post('TEST_SEED', 'race-club-seed', 'seed', null,
      jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', 5000),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -5000)))`, [CLUB])
    const race = await rpc<string>(db, OWNER, `select public.create_virtual_race($1::jsonb) as r`, [body({ club_id: CLUB, max_participants: 300 })])
    expect((await db.query<{ fee_charged: number }>(`select fee_charged from public.virtual_races where id = $1`, [race])).rows[0].fee_charged).toBe(3500)
    expect(await xu(db, CLUB)).toBe(1500)
  })
})
