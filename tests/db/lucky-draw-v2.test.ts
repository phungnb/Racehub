import { createHash } from 'node:crypto'
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 009300: quay thưởng trên sân khấu — BTC chọn danh sách / loại trừ, quay từng giải, vắng mặt quay lại, công bố
const id = (n: number) => `00000000-0000-0000-0000-0000000093${String(n).padStart(2, '0')}`
const OWN = id(1), OUT = id(99)
const M = [2, 3, 4, 5, 6, 7].map(id)
const CLUB = '00000000-0000-0000-0000-0000000093c1'
type Row = Record<string, any>
const md5 = (s: string) => createHash('md5').update(s).digest('hex')

async function seed(db: PGlite) {
  const all = [OWN, OUT, ...M]
  await db.exec(`
    insert into auth.users (id, email) values ${all.map((u, i) => `('${u}', 'u${i}@q93.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${all.map((u, i) => `('${u}', 'Người ${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r as T
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('quay thưởng v2 (009300)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.exec(`
      insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB Quay 93', '${OWN}', 'quay93');
      insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${OWN}', 'OWNER', 'APPROVED'),
        ${M.map((u) => `('${CLUB}', '${u}', 'MEMBER', 'APPROVED')`).join(', ')} on conflict do nothing;
    `)
  }, 240_000)

  it('BTC chọn danh sách + loại trừ: chỉ giữ người thuộc CLB; danh sách người để chọn chỉ BTC xem', async () => {
    const cands = await rpc<Row[]>(db, OWN, `select public.lucky_draw_candidates('CLUB', $1) as r`, [CLUB])
    expect(cands.map((c) => c.user_id).sort()).toEqual([OWN, ...M].sort())
    expect(await fails(rpc(db, M[0], `select public.lucky_draw_candidates('CLUB', $1) as r`, [CLUB]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, OWN, `select public.create_lucky_draw('CLUB', $1, $2::jsonb) as r`,
      [CLUB, JSON.stringify({ title: 'Chọn tay', rule: 'PICKED', picked: [OUT], prizes: [{ name: 'Áo', qty: 1 }] })]))).toContain('PICK_REQUIRED')
    const d = await rpc(db, OWN, `select public.create_lucky_draw('CLUB', $1, $2::jsonb) as r`, [CLUB, JSON.stringify({
      title: 'Quay người được đề cử', rule: 'PICKED', picked: [M[0], M[1], M[2], OUT], excluded: [M[0]], prizes: [{ name: 'Giày', qty: 1 }] })])
    expect(d).toMatchObject({ rule: 'PICKED', picked_count: 3, excluded_count: 1, eligible_now: 2 })
    expect(d.picked).toBeUndefined()
    const r = await rpc(db, OWN, `select public.run_lucky_draw($1) as r`, [d.id])
    expect(r.status).toBe('DONE')
    expect([M[1], M[2]]).toContain(r.winners[0].user_id)
  })

  it('quay từng giải trên sân khấu: thứ tự cố định theo seed, vắng mặt quay lại, không huỷ được khi đã có người trúng', async () => {
    const d = await rpc(db, OWN, `select public.create_lucky_draw('CLUB', $1, $2::jsonb) as r`, [CLUB, JSON.stringify({
      title: 'Tất niên', rule: 'ALL', exclude_winners: false, excluded: [OWN], prizes: [{ name: 'Giải nhì', qty: 2 }, { name: 'Giải nhất', qty: 1 }] })])
    // thành viên chưa thấy lượt chưa quay
    expect((await rpc<Row[]>(db, M[3], `select public.lucky_draws_for('CLUB', $1) as r`, [CLUB])).some((x) => x.id === d.id)).toBe(false)
    const live = await rpc(db, OWN, `select public.start_lucky_draw($1) as r`, [d.id])
    expect(live).toMatchObject({ status: 'LIVE', entrant_count: 6, seed: null })
    expect(live.seed_hash).toMatch(/^[0-9a-f]{32}$/)
    // thành viên xem trực tiếp: thấy lượt đang quay + tên trong vòng quay, không thấy seed
    const view = (await rpc<Row[]>(db, M[3], `select public.lucky_draws_for('CLUB', $1) as r`, [CLUB])).find((x) => x.id === d.id)!
    expect(view).toMatchObject({ status: 'LIVE', can_manage: false, seed: null })
    expect(view.reel.length).toBe(6)
    expect(await fails(rpc(db, M[3], `select public.draw_next($1, 0) as r`, [d.id]))).toContain('FORBIDDEN')

    const a = await rpc(db, OWN, `select public.draw_next($1, 1) as r`, [d.id])            // giải nhất trước cũng được
    const first = a.winners[0]
    expect(first).toMatchObject({ prize: 'Giải nhất', prize_idx: 1, status: 'WON', position: 1 })
    expect(await fails(rpc(db, OWN, `select public.draw_next($1, 1) as r`, [d.id]))).toContain('PRIZE_FULL')
    expect(await fails(rpc(db, OWN, `select public.cancel_lucky_draw($1) as r`, [d.id]))).toContain('DRAW_STARTED')
    // vắng mặt → suất trả lại, quay tiếp cho người khác
    const ab = await rpc(db, OWN, `select public.draw_absent($1, $2) as r`, [d.id, first.user_id])
    expect(ab.winners[0].status).toBe('ABSENT')
    const b = await rpc(db, OWN, `select public.draw_next($1, 1) as r`, [d.id])
    expect(b.winners[1]).toMatchObject({ prize: 'Giải nhất', status: 'WON', position: 2 })
    expect(b.winners[1].user_id).not.toBe(first.user_id)
    await rpc(db, OWN, `select public.draw_next($1, 0) as r`, [d.id])
    const done = await rpc(db, OWN, `select public.finish_lucky_draw($1) as r`, [d.id])
    expect(done.status).toBe('DONE')
    expect(md5(done.seed)).toBe(done.seed_hash)                                               // seed công bố khớp mã băm đã cam kết
    // thứ tự người mở ra đúng bằng sắp xếp md5(seed || user_id)
    const order = [...M].sort((x, y) => md5(done.seed + x).localeCompare(md5(done.seed + y)))
    expect(done.winners.map((w: Row) => w.user_id)).toEqual(order.slice(0, 3))
    // chỉ người trúng (không tính vắng mặt) được báo
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'LUCKY_DRAW_WIN' and body = 'Tất niên'`, [first.user_id])).rows).toHaveLength(0)
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'LUCKY_DRAW_WIN' and body = 'Tất niên'`, [b.winners[1].user_id])).rows).toHaveLength(1)
  })

  it('đang quay dở → "Quay nhanh" quay nốt phần còn lại rồi công bố', async () => {
    const d = await rpc(db, OWN, `select public.create_lucky_draw('CLUB', $1, $2::jsonb) as r`, [CLUB, JSON.stringify({
      title: 'Quà tháng', rule: 'ALL', exclude_winners: false, prizes: [{ name: 'Bình nước', qty: 3 }] })])
    await rpc(db, OWN, `select public.start_lucky_draw($1) as r`, [d.id])
    await rpc(db, OWN, `select public.draw_next($1, 0) as r`, [d.id])
    const r = await rpc(db, OWN, `select public.run_lucky_draw($1) as r`, [d.id])
    expect(r.status).toBe('DONE')
    expect(r.winners.filter((w: Row) => w.status === 'WON')).toHaveLength(3)
  })
})
