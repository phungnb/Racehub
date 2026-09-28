import { createHash } from 'node:crypto'
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 009500: quay thưởng cho người điểm danh tại buổi, danh sách dán, nhà tài trợ
const id = (n: number) => `00000000-0000-0000-0000-0000000095${String(n).padStart(2, '0')}`
const OWN = id(1)
const M = [2, 3, 4, 5].map(id)
const CLUB = '00000000-0000-0000-0000-0000000095c1'
type Row = Record<string, any>
const md5 = (s: string) => createHash('md5').update(s).digest('hex')

async function seed(db: PGlite) {
  const all = [OWN, ...M]
  await db.exec(`
    insert into auth.users (id, email) values ${all.map((u, i) => `('${u}', 'u${i}@q95.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${all.map((u, i) => `('${u}', 'Người ${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r as T
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const create = (db: PGlite, p: Row) => rpc(db, OWN, `select public.create_lucky_draw('CLUB', $1, $2::jsonb) as r`, [CLUB, JSON.stringify(p)])

describe('quay thưởng: buổi điểm danh, danh sách dán, nhà tài trợ (009500)', () => {
  let db: PGlite
  let ev: string
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.exec(`
      insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB 95', '${OWN}', 'quay95');
      insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${OWN}', 'OWNER', 'APPROVED'),
        ${M.map((u) => `('${CLUB}', '${u}', 'MEMBER', 'APPROVED')`).join(', ')} on conflict do nothing;
    `)
    ev = (await db.query<{ id: string }>(`insert into public.club_events (club_id, created_by, title, starts_at) values ($1, $2, 'Tất niên', now() - interval '1 hour') returning id`, [CLUB, OWN])).rows[0].id
    await db.query(`insert into public.club_event_rsvps (event_id, user_id, status, checked_in_at, checkin_method) values
      ($1, $2, 'GOING', now(), 'QR'), ($1, $3, 'GOING', now(), 'STAFF'), ($1, $4, 'GOING', null, null)`, [ev, M[0], M[1], M[2]])
  }, 240_000)

  it('chỉ người đã điểm danh ở buổi được quay; buổi phải thuộc CLB', async () => {
    const evs = await rpc<Row[]>(db, OWN, `select public.club_draw_events($1) as r`, [CLUB])
    expect(evs).toEqual([expect.objectContaining({ id: ev, checked_in: 2 })])
    expect(await fails(rpc(db, M[0], `select public.club_draw_events($1) as r`, [CLUB]))).toContain('FORBIDDEN')
    expect(await fails(create(db, { title: 'Sai buổi', rule: 'EVENT', event_id: '00000000-0000-0000-0000-000000000000', prizes: [{ name: 'Áo', qty: 1 }] }))).toContain('EVENT_REQUIRED')
    const d = await create(db, { title: 'Quà người có mặt', rule: 'EVENT', event_id: ev, exclude_winners: false, prizes: [{ name: 'Áo', qty: 5 }] })
    expect(d).toMatchObject({ rule: 'EVENT', eligible_now: 2, event: { id: ev, title: 'Tất niên' } })
    const r = await rpc(db, OWN, `select public.run_lucky_draw($1) as r`, [d.id])
    expect(r.winners.map((w: Row) => w.user_id).sort()).toEqual([M[0], M[1]].sort())
  })

  it('dán danh sách: bỏ dòng trống, quay từng giải, vắng mặt theo khoá, thứ tự = md5(seed || khoá), nhà tài trợ lên kết quả', async () => {
    expect(await fails(create(db, { title: 'Dán rỗng', rule: 'MANUAL', names: ['  ', ''], prizes: [{ name: 'Áo', qty: 1 }] }))).toContain('NAMES_REQUIRED')
    expect(await fails(create(db, { title: 'Tài trợ lạ', rule: 'ALL', sponsor: { name: 'X', logo_url: 'http://a.vn/x.png' }, prizes: [{ name: 'Áo', qty: 1 }] }))).toContain('INVALID_SPONSOR')
    const names = ['Khách mời An', '', 'Chị Bình (nhà tài trợ)', 'Anh Cường', 'Anh Cường', 'Em Dũng']
    const d = await create(db, { title: 'Khách mời', rule: 'MANUAL', names, prizes: [{ name: 'Giải nhất', qty: 1 }, { name: 'Giải nhì', qty: 2 }],
      sponsor: { name: 'Cửa hàng Chạy Bộ', logo_url: 'https://cdn.vn/logo.png' } })
    expect(d).toMatchObject({ rule: 'MANUAL', manual_count: 5, eligible_now: 5, sponsor: { name: 'Cửa hàng Chạy Bộ' } })
    expect(d.manual_names).toBeUndefined()
    const live = await rpc(db, OWN, `select public.start_lucky_draw($1) as r`, [d.id])
    expect(live.reel).toHaveLength(5)
    const a = await rpc(db, OWN, `select public.draw_next($1, 1) as r`, [d.id])
    const first = a.winners[0]
    expect(first.user_id).toBeNull()
    await rpc(db, OWN, `select public.draw_absent_key($1, $2) as r`, [d.id, first.key])
    await rpc(db, OWN, `select public.draw_next($1, 1) as r`, [d.id])
    await rpc(db, OWN, `select public.draw_next($1, 0) as r`, [d.id])
    const done = await rpc(db, OWN, `select public.finish_lucky_draw($1) as r`, [d.id])
    const keys = names.filter(Boolean).map((n, i) => `${String(i + 1).padStart(4, '0')}|${n}`)
    const order = [...keys].sort((x, y) => md5(done.seed + x).localeCompare(md5(done.seed + y)))
    expect(done.winners.map((w: Row) => w.key)).toEqual(order.slice(0, 3))
    expect(done.winners[0]).toMatchObject({ status: 'ABSENT', name: order[0].slice(5) })
    // hai "Anh Cường" là hai dòng khác nhau
    expect(new Set(done.winners.map((w: Row) => w.key)).size).toBe(3)
    const post = (await db.query<{ body: string }>(`select body from public.club_posts where club_id = $1 and title = 'Quay thưởng: Khách mời'`, [CLUB])).rows[0]
    expect(post.body).toContain('tài trợ: Cửa hàng Chạy Bộ')
    const absentName = order[0].slice(5)
    if (!done.winners.some((w: Row) => w.status === 'WON' && w.name === absentName)) expect(post.body).not.toContain(absentName + ' (')   // người vắng mặt không có trong công bố
  })
})
