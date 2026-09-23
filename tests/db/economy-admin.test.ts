import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 000700: chính sách Xu, phí thử thách theo số người, vé miễn phí, admin điều phối Xu
const ADMIN = '00000000-0000-0000-0000-0000000000e0'
const U = '00000000-0000-0000-0000-0000000000e1'     // người thường
const V = '00000000-0000-0000-0000-0000000000e2'     // thành viên CLB

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'boss@x.vn'), ('${U}', 'lan@x.vn'), ('${V}', 'vu@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, role, created_at) values
      ('${ADMIN}', 'Quản trị', 0, 0, 1, 'SYSTEM_ADMIN', now()), ('${U}', 'Lan', 0, 0, 1, 'MEMBER', now()),
      ('${V}', 'Vũ', 0, 0, 1, 'MEMBER', now());
  `)
}

type Row = Record<string, unknown>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) =>
  (await asUser<T>(db, uid, '/rpc', sql, params)).rows
const fails = async (db: PGlite, uid: string, sql: string, params: unknown[] = []) => {
  try { await asUser(db, uid, '/rpc', sql, params) } catch (e) { return (e as Error).message }
  return 'OK'
}
const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
const xu = async (db: PGlite, id: string) => Number((await db.query<{ b: string }>(`select private.balance($1) as b`, [id])).rows[0].b)
let seq = 0
const create = (db: PGlite, uid: string, p: Row) =>
  rpc<{ r: { challenge_id: string; fee: number; fee_waived: number; pass_used: boolean } }>(db, uid,
    `select public.create_challenge_v2($1::jsonb, $2) as r`, [JSON.stringify(p), `eco-key-${++seq}`]).then((r) => r[0].r)
const grant = (db: PGlite, type: 'USER' | 'CLUB', id: string, amount: number, key: string, reason = 'Thưởng sự kiện') =>
  rpc<{ r: { balance: number } }>(db, ADMIN, `select public.admin_grant_xu($1, $2, $3, 'BONUS', $4, $5) as r`, [type, id, amount, reason, key])

describe('Kinh tế Xu & điều phối admin (000700)', () => {
  let db: PGlite
  let club: string

  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    club = (await rpc<{ c: { id: string } }>(db, U, `select public.create_club('Sông Hồng Runners') as c`))[0].c.id
    await db.query(`update public.clubs set join_policy = 'OPEN' where id = $1`, [club])
    await rpc(db, V, `select public.join_club($1)`, [club])
  }, 240_000)

  it('biểu phí: ≤5 người miễn phí, 6–10 người 3 Xu/người, trên 10 người 5 Xu/người', async () => {
    const fee = async (n: number) => Number((await db.query<{ f: number }>(
      `select private.challenge_creation_fee(false, $1, now(), now() + interval '1 day') as f`, [n])).rows[0].f)
    expect(await fee(2)).toBe(0)
    expect(await fee(5)).toBe(0)
    expect(await fee(6)).toBe(18)
    expect(await fee(10)).toBe(30)
    expect(await fee(11)).toBe(55)
    expect(await fee(100)).toBe(500)
    const q = (await rpc<{ q: Row }>(db, U, `select public.quote_challenge(20) as q`))[0].q
    expect(q).toMatchObject({ fee: 100, payer: 'USER', xu_vnd: 1000, pass: null })
  })

  it('thử thách ≤5 người tạo được khi ví 0 Xu', async () => {
    const r = await create(db, U, { title: 'Nhóm nhỏ', format: 'RANKED', max_slots: 5, start_date: iso(-1), end_date: iso(48) })
    expect(r.fee).toBe(0)
    expect(await fails(db, U, `select public.create_challenge_v2($1::jsonb, 'eco-big-0001')`,
      [JSON.stringify({ title: 'Nhóm to', format: 'RANKED', max_slots: 20, start_date: iso(-1), end_date: iso(48) })]))
      .toContain('INSUFFICIENT_BALANCE')
  })

  it('chỉ admin điều phối; người thường bị từ chối', async () => {
    expect(await fails(db, U, `select public.admin_grant_xu('USER', $1, 100, 'BONUS', 'Tự cộng cho mình', 'self-grant-1')`, [U]))
      .toMatch(/FORBIDDEN|permission|42501/)
    expect(await fails(db, U, `select public.admin_grant_challenge_pass('USER', $1, 1, 50, null, 'x')`, [U])).toMatch(/FORBIDDEN|permission|42501/)
    expect(await fails(db, U, `select * from public.admin_search_accounts('Lan')`)).toMatch(/FORBIDDEN|permission|42501/)
  })

  it('admin tìm tài khoản, cộng Xu cho cá nhân: có sổ cái, nhật ký, thông báo; gửi lại không cộng 2 lần', async () => {
    const found = await rpc<{ kind: string; id: string }>(db, ADMIN, `select * from public.admin_search_accounts('lan@x')`)
    expect(found.map((x) => x.id)).toContain(U)
    const clubs = await rpc<{ kind: string; id: string }>(db, ADMIN, `select * from public.admin_search_accounts('Sông Hồng')`)
    expect(clubs).toContainEqual(expect.objectContaining({ kind: 'CLUB', id: club }))

    expect(await fails(db, ADMIN, `select public.admin_grant_xu('USER', $1, 100, 'BONUS', 'x', 'short-reason')`, [U])).toContain('REASON_REQUIRED')
    await grant(db, 'USER', U, 200, 'grant-user-0001')
    await grant(db, 'USER', U, 200, 'grant-user-0001')
    expect(await xu(db, U)).toBe(200)
    expect(Number((await db.query<{ xu: string }>(`select xu from public.profiles where id = $1`, [U])).rows[0].xu)).toBe(200)
    expect((await db.query(`select 1 from public.admin_audit_log where action = 'ADMIN_GRANT_XU' and target = $1`, [`USER:${U}`])).rows).toHaveLength(1)
    expect((await asUser(db, U, '/notifications', `select 1 from public.notifications where kind = 'ADMIN_XU'`)).rows).toHaveLength(1)
  })

  it('admin trừ Xu: không cho âm số dư', async () => {
    expect(await fails(db, ADMIN, `select public.admin_grant_xu('USER', $1, -500, 'BONUS', 'Thu hồi do gian lận', 'deduct-too-much')`, [U]))
      .toMatch(/INSUFFICIENT|NEGATIVE/)
    await grant(db, 'USER', U, -50, 'deduct-user-001', 'Thu hồi do gian lận')
    expect(await xu(db, U)).toBe(150)
  })

  it('cộng Xu cho quỹ CLB: ghi nhật ký quỹ, báo ban quản trị; thử thách CLB trừ phí vào quỹ', async () => {
    await grant(db, 'CLUB', club, 300, 'grant-club-0001', 'Tài trợ giải CLB')
    expect(await xu(db, club)).toBe(300)
    expect((await db.query(`select 1 from public.club_treasury_log where club_id = $1 and note like 'RaceHub tặng%'`, [club])).rows).toHaveLength(1)
    const q = (await rpc<{ q: Row }>(db, U, `select public.quote_challenge(20, 'RANKED', $1) as q`, [club]))[0].q
    expect(q).toMatchObject({ fee: 100, payer: 'CLUB' })
    expect(Number(q.payer_balance)).toBe(300)
    const walletBefore = await xu(db, U)
    const r = await create(db, U, { title: 'Giải tháng CLB', format: 'RANKED', audience: 'CLUB_ONLY', club_id: club, max_slots: 20,
      start_date: iso(-1), end_date: iso(48) })
    expect(r.fee).toBe(100)
    expect(await xu(db, club)).toBe(200)
    expect(await xu(db, U)).toBe(walletBefore)             // ví cá nhân không bị trừ
    expect(await fails(db, U, `select public.create_challenge_v2($1::jsonb, 'eco-club-poor')`,
      [JSON.stringify({ title: 'Quá lớn', format: 'RANKED', audience: 'CLUB_ONLY', club_id: club, max_slots: 100, start_date: iso(-1), end_date: iso(48) })]))
      .toContain('INSUFFICIENT_TREASURY')
  })

  it('vé miễn phí: tự dùng khi đủ sức chứa, trừ lượt, hết lượt thì thu phí; admin thu hồi được', async () => {
    const pass = (await rpc<{ id: string }>(db, ADMIN, `select public.admin_grant_challenge_pass('CLUB', $1, 1, 50, null, 'Mừng CLB mới') as id`, [club]))[0].id
    const mine = await rpc<{ id: string; remaining: number }>(db, U, `select * from public.my_challenge_passes()`)
    expect(mine).toContainEqual(expect.objectContaining({ id: pass, remaining: 1 }))
    expect((await asUser(db, V, '/passes', `select id from public.challenge_passes`)).rows).toHaveLength(1)   // thành viên xem được
    const q = (await rpc<{ q: { pass: { id: string } | null } }>(db, U, `select public.quote_challenge(80, 'RANKED', $1) as q`, [club]))[0].q
    expect(q.pass).toBeNull()                                 // vé chỉ cho tối đa 50 người
    const before = await xu(db, club)
    const r = await create(db, U, { title: 'Dùng vé', format: 'RANKED', audience: 'CLUB_ONLY', club_id: club, max_slots: 40,
      start_date: iso(-1), end_date: iso(48) })
    expect(r).toMatchObject({ fee: 0, fee_waived: 200, pass_used: true })
    expect((await db.query(`select pass_id from public.challenges where id = $1`, [r.challenge_id])).rows[0]).toMatchObject({ pass_id: pass })
    expect(await xu(db, club)).toBe(before)
    const left = (await db.query<{ remaining: number }>(`select remaining from public.challenge_passes where id = $1`, [pass])).rows[0]
    expect(left.remaining).toBe(0)

    const p2 = (await rpc<{ id: string }>(db, ADMIN, `select public.admin_grant_challenge_pass('USER', $1, 3, 20, null, null) as id`, [U]))[0].id
    await rpc(db, ADMIN, `select public.admin_revoke_challenge_pass($1, 'Cấp nhầm người')`, [p2])
    const list = await rpc<{ id: string; remaining: number }>(db, ADMIN, `select * from public.admin_list_passes()`)
    expect(list).toContainEqual(expect.objectContaining({ id: p2, remaining: 0 }))
  })

  it('tổng quan & chính sách: admin sửa biểu phí thì áp dụng ngay; cấu hình sai bị từ chối', async () => {
    const o = (await rpc<{ o: Row }>(db, ADMIN, `select public.admin_economy_overview() as o`))[0].o
    expect(Number(o.granted_30d)).toBeGreaterThanOrEqual(500)
    expect((o.recent as unknown[]).length).toBeGreaterThan(0)
    expect(await fails(db, ADMIN, `select public.admin_publish_config('economy_global_config', $1::jsonb)`,
      [JSON.stringify({ challengeFee: { freeMaxSlots: 10, midMaxSlots: 5, midRatePerSlot: 3, ratePerSlot: 5 } })])).toContain('INVALID_CONFIG')
    await rpc(db, ADMIN, `select public.admin_publish_config('economy_global_config', $1::jsonb)`,
      [JSON.stringify({ firstKmXu: 1, extraKmXu: 0.2, maxDailyReward: 10, challengeFee: { freeMaxSlots: 10, midMaxSlots: 20, midRatePerSlot: 2, ratePerSlot: 4 } })])
    const q = (await rpc<{ q: Row }>(db, U, `select public.quote_challenge(10) as q`))[0].q
    expect(q.fee).toBe(0)
    const pol = (await rpc<{ p: Row }>(db, V, `select public.economy_policy() as p`))[0].p
    expect(pol).toMatchObject({ xuVnd: 1000, challengeFee: { freeMaxSlots: 10, ratePerSlot: 4 } })
  })
})
