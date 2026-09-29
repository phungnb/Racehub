import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 010600: sự kiện nhiều cự ly + báo cả CLB khi đổi lịch
const [OWNER, A, B] = [1, 2, 3].map((n) => `00000000-0000-0000-0000-0000001060${String(n).padStart(2, '0')}`)
type Row = Record<string, any>

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o106@x.vn'), ('${A}', 'a106@x.vn'), ('${B}', 'b106@x.vn');
    insert into public.profiles (id, display_name) values ('${OWNER}', 'Chủ nhiệm'), ('${A}', 'An'), ('${B}', 'Bình') on conflict do nothing;
  `)
}
const rpc = async <T = Row,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('sự kiện nhiều cự ly (010600)', () => {
  let db: PGlite
  let club: string
  const notes = async (uid: string, prefix: string) => Number((await db.query<{ n: string }>(
    `select count(*) n from public.notifications where user_id = $1 and kind = 'CLUB_EVENT' and title like $2`, [uid, `${prefix}%`])).rows[0].n)

  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    const c = await rpc<{ id: string; invite_code: string }>(db, OWNER, `select public.create_club('Hồ Tây 106', 'Chạy sáng') as r`)
    club = c.id
    await db.query(`update public.clubs set join_policy = 'OPEN' where id = $1`, [club])
    for (const u of [A, B]) await asUser(db, u, '/rpc', `select public.join_club_by_code($1)`, [c.invite_code])
  }, 300_000)

  it('tạo với nhiều cự ly; cự ly đầu giữ ở cột cũ; cả CLB nhận thông báo', async () => {
    const starts = new Date(Date.now() + 2 * 86_400_000).toISOString()
    const e = await rpc(db, OWNER, `select public.create_club_event($1, $2::jsonb) as r`, [club, JSON.stringify({
      title: 'Long run Chủ nhật', starts_at: starts, duration_min: 90, location_name: 'Amata',
      routes: [{ km: 10, pace: '6:00–6:30' }, { km: '21,1'.replace(',', '.'), pace: '5:30' }, { km: '', pace: '' }],
    })])
    expect(e.routes).toEqual([{ km: 10, pace: '6:00–6:30' }, { km: 21.1, pace: '5:30' }])
    expect(Number(e.distance_km)).toBe(10)
    expect(e.pace_text).toBe('6:00–6:30')
    expect(await notes(A, 'Sự kiện mới')).toBe(1)
    expect(await notes(B, 'Sự kiện mới')).toBe(1)

    // Đổi giờ → cả CLB được báo "Đổi lịch"; đổi mỗi ghi chú thì không
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString()
    await rpc(db, OWNER, `select public.update_club_event($1, $2::jsonb) as r`, [e.id, JSON.stringify({
      title: 'Long run Chủ nhật', starts_at: later, duration_min: 90, location_name: 'Amata', routes: e.routes })])
    await rpc(db, OWNER, `select public.update_club_event($1, $2::jsonb) as r`, [e.id, JSON.stringify({
      title: 'Long run Chủ nhật', starts_at: later, duration_min: 90, location_name: 'Amata', routes: e.routes, description: 'Mang nước' })])
    expect(await notes(A, 'Đổi lịch')).toBe(1)
  })

  it('sự kiện cũ (chỉ có cự ly đơn) vẫn trả routes; dữ liệu sai bị chặn', async () => {
    const starts = new Date(Date.now() + 86_400_000).toISOString()
    const e = await rpc(db, OWNER, `select public.create_club_event($1, $2::jsonb) as r`, [club, JSON.stringify({
      title: 'Chạy nhẹ', starts_at: starts, duration_min: 60, distance_km: 5, pace_text: '7:00' })])
    expect(e.routes).toEqual([{ km: 5, pace: '7:00' }])
    const bad = (routes: unknown) => fails(rpc(db, OWNER, `select public.create_club_event($1, $2::jsonb) as r`, [club, JSON.stringify({
      title: 'Sai', starts_at: starts, duration_min: 60, routes })]))
    expect(await bad([{ km: 300 }])).toContain('INVALID_EVENT')
    expect(await bad([{ km: 'abc' }])).toContain('INVALID_EVENT')
    expect(await bad(Array.from({ length: 7 }, () => ({ km: 5 })))).toContain('INVALID_EVENT')
  })
})
