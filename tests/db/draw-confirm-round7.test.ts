import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 013500 (chỉnh sửa lần 7): kết quả quay thưởng chờ Ban tổ chức chấp nhận / huỷ; huỷ thì ghi nhật ký và quay lại
const id = (n: number) => `00000000-0000-0000-0000-0000000135${String(n).padStart(2, '0')}`
const OWN = id(1)
const M = [2, 3, 4, 5].map(id)
const OUT = id(9)
const CLUB = '00000000-0000-0000-0000-0000000135c1'
type Row = Record<string, any>

async function seed(db: PGlite) {
  const all = [OWN, ...M, OUT]
  await db.exec(`
    insert into auth.users (id, email) values ${all.map((u, i) => `('${u}', 'u${i}@q135.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${all.map((u, i) => `('${u}', 'Người ${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string | null, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r as T
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const create = (db: PGlite, title: string) =>
  rpc(db, OWN, `select public.create_lucky_draw('CLUB', $1, $2::jsonb) as r`, [CLUB, JSON.stringify({ title, rule: 'ALL', exclude_winners: false, prizes: [{ name: 'Áo', qty: 2 }] })])
const posts = async (db: PGlite, title: string) => (await db.query(`select 1 from public.club_posts where club_id = $1 and title = $2`, [CLUB, `Quay thưởng: ${title}`])).rows.length
const wins = async (db: PGlite, title: string) => (await db.query(`select 1 from public.notifications where kind = 'LUCKY_DRAW_WIN' and body = $1`, [title])).rows.length
const view = async (db: PGlite, uid: string, drawId: string) =>
  (await rpc<Row[]>(db, uid, `select public.lucky_draws_for('CLUB', $1) as r`, [CLUB])).find((d) => d.id === drawId)!

describe('quay thưởng: Ban tổ chức chấp nhận / huỷ kết quả (013500)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.exec(`
      insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB 135', '${OWN}', 'quay135');
      insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${OWN}', 'OWNER', 'APPROVED'),
        ${M.map((u) => `('${CLUB}', '${u}', 'MEMBER', 'APPROVED')`).join(', ')} on conflict do nothing;
    `)
  }, 240_000)

  it('quay xong → chờ xác nhận: chưa báo người trúng, chưa đăng bảng tin; người không có quyền không chấp nhận / huỷ được', async () => {
    const d = await create(db, 'Chờ xác nhận')
    const r = await rpc(db, OWN, `select public.run_lucky_draw($1) as r`, [d.id])
    expect(r.status).toBe('PENDING')
    expect(r.winners.filter((w: Row) => w.status === 'WON')).toHaveLength(2)
    expect(r.seed).toMatch(/^[0-9a-f]{32}$/)                          // ban tổ chức đối chiếu được trước khi chấp nhận
    expect(await posts(db, 'Chờ xác nhận')).toBe(0)
    expect(await wins(db, 'Chờ xác nhận')).toBe(0)
    for (const who of [M[0], OUT]) {
      expect(await fails(rpc(db, who, `select public.confirm_lucky_draw($1) as r`, [d.id]))).toContain('FORBIDDEN')
      expect(await fails(rpc(db, who, `select public.reject_lucky_draw($1, 'không thích') as r`, [d.id]))).toContain('FORBIDDEN')
    }
    expect(await fails(rpc(db, null, `select public.confirm_lucky_draw($1) as r`, [d.id]))).toContain('permission denied')
    expect(await fails(rpc(db, null, `select public.reject_lucky_draw($1) as r`, [d.id]))).toContain('permission denied')
    // Chưa chấp nhận thì không huỷ lượt quay kiểu cũ, không chấp nhận lượt chưa quay xong
    expect(await fails(rpc(db, OWN, `select public.cancel_lucky_draw($1) as r`, [d.id]))).toContain('DRAW_CLOSED')
    const other = await create(db, 'Chưa quay')
    expect(await fails(rpc(db, OWN, `select public.confirm_lucky_draw($1) as r`, [other.id]))).toContain('DRAW_NOT_PENDING')
    expect(await fails(rpc(db, OWN, `select public.reject_lucky_draw($1) as r`, [other.id]))).toContain('DRAW_NOT_PENDING')
    expect((await view(db, M[0], d.id)).status).toBe('PENDING')
  })

  it('huỷ kết quả: ghi nhật ký (ai, lúc nào, lý do, kết quả bị huỷ), xoá người trúng, quay lại với seed mới; rồi chấp nhận → công bố', async () => {
    const d = await create(db, 'Tất niên 135')
    const first = await rpc(db, OWN, `select public.run_lucky_draw($1) as r`, [d.id])
    const firstKeys = first.winners.map((w: Row) => w.key)
    expect(await fails(rpc(db, OWN, `select public.reject_lucky_draw($1, $2) as r`, [d.id, 'x'.repeat(301)]))).toContain('REASON_TOO_LONG')
    const back = await rpc(db, OWN, `select public.reject_lucky_draw($1, $2) as r`, [d.id, '  Nhầm danh sách  '])
    expect(back).toMatchObject({ status: 'READY', winners: [], seed: null, seed_hash: null, reject_count: 1 })
    expect(back.rejections).toEqual([expect.objectContaining({ by_name: 'Người 0', reason: 'Nhầm danh sách', seed: first.seed, entrant_count: 5 })])
    expect(back.rejections[0].winners.map((w: Row) => w.key)).toEqual(firstKeys)
    const log = (await db.query<Row>(`select rejected_by, rejected_at, reason from public.lucky_draw_rejections where draw_id = $1`, [d.id])).rows
    expect(log).toEqual([expect.objectContaining({ rejected_by: OWN, reason: 'Nhầm danh sách' })])
    expect(log[0].rejected_at).toBeTruthy()
    expect((await db.query(`select 1 from public.lucky_draw_winners where draw_id = $1`, [d.id])).rows).toHaveLength(0)
    // Thành viên thấy số lần huỷ nhưng không thấy chi tiết; bảng nhật ký không đọc thẳng được
    const seen = await view(db, M[1], d.id)
    expect(seen).toBeUndefined()                                         // READY: thành viên không thấy (như trước)
    expect(await fails(rpc(db, M[1], `select count(*) as r from public.lucky_draw_rejections`))).toContain('permission denied')

    // Quay lại: seed mới, chờ xác nhận lần nữa
    const again = await rpc(db, OWN, `select public.run_lucky_draw($1) as r`, [d.id])
    expect(again.status).toBe('PENDING')
    expect(again.seed).not.toBe(first.seed)
    const member = await view(db, M[1], d.id)
    expect(member).toMatchObject({ status: 'PENDING', reject_count: 1 })
    expect(member.rejections).toBeNull()
    expect(await posts(db, 'Tất niên 135')).toBe(0)

    const done = await rpc(db, OWN, `select public.confirm_lucky_draw($1) as r`, [d.id])
    expect(done).toMatchObject({ status: 'DONE', confirmed_by_name: 'Người 0', reject_count: 1 })
    expect(done.confirmed_at).toBeTruthy()
    expect(done.confirmed_by).toBeUndefined()
    expect(await posts(db, 'Tất niên 135')).toBe(1)
    expect(await wins(db, 'Tất niên 135')).toBe(done.winners.filter((w: Row) => w.user_id !== OWN).length)   // người bấm chấp nhận không tự báo cho mình
    // Bấm lại không công bố hai lần; đã chính thức thì không huỷ được nữa
    await rpc(db, OWN, `select public.confirm_lucky_draw($1) as r`, [d.id])
    expect(await posts(db, 'Tất niên 135')).toBe(1)
    expect(await fails(rpc(db, OWN, `select public.reject_lucky_draw($1) as r`, [d.id]))).toContain('DRAW_NOT_PENDING')
  })

  it('dữ liệu cũ: lượt DONE từ trước vẫn là kết quả chính thức (coi như đã chấp nhận)', async () => {
    const old = (await db.query<{ id: string }>(`insert into public.lucky_draws (scope, ref_id, title, rule, prizes, status, seed, entrant_count, run_at, created_by)
      values ('CLUB', $1, 'Lượt cũ', 'ALL', '[{"name":"Áo","qty":1}]', 'DONE', 'abc', 4, now() - interval '30 days', $2) returning id`, [CLUB, OWN])).rows[0].id
    await db.query(`insert into public.lucky_draw_winners (draw_id, user_id, prize, prize_idx, position, status) values ($1, $2, 'Áo', 0, 1, 'WON')`, [old, M[2]])
    const v = await view(db, M[2], old)
    expect(v).toMatchObject({ status: 'DONE', seed: 'abc', confirmed_at: null, reject_count: 0 })
    expect(v.winners[0]).toMatchObject({ me: true, status: 'WON' })
    expect(await fails(rpc(db, OWN, `select public.reject_lucky_draw($1) as r`, [old]))).toContain('DRAW_NOT_PENDING')
  })
})
