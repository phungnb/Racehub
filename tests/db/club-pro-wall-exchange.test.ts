import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 008100: tường nhà CLB Pro (ảnh bìa, khẩu hiệu, chủ đề) + thư mời giao lưu offline giữa các CLB
const A_OWN = '00000000-0000-0000-0000-0000000081a1'
const A_MEM = '00000000-0000-0000-0000-0000000081a2'
const B_OWN = '00000000-0000-0000-0000-0000000081b1'
const B_MEM = '00000000-0000-0000-0000-0000000081b2'
const CA = '00000000-0000-0000-0000-0000000081c1'
const CB = '00000000-0000-0000-0000-0000000081c2'
type Row = Record<string, any>
const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

async function seed(db: PGlite) {
  const users = [A_OWN, A_MEM, B_OWN, B_MEM]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'u81${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ${users.map((u, i) => `('${u}', 'Người ${i}', 0, 0, 1, now())`).join(', ')}
      on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CA}', 'Hồ Tây Runners', '${A_OWN}', 'hotay81'), ('${CB}', 'Long Biên Run', '${B_OWN}', 'lbien81');
    insert into public.club_members (club_id, user_id, role, status) values
      ('${CA}', '${A_OWN}', 'OWNER', 'APPROVED'), ('${CA}', '${A_MEM}', 'MEMBER', 'APPROVED'),
      ('${CB}', '${B_OWN}', 'OWNER', 'APPROVED'), ('${CB}', '${B_MEM}', 'MEMBER', 'APPROVED') on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const invite = (db: PGlite, uid: string, from: string, to: string, extra: object = {}) => rpc<Row>(db, uid, `select public.send_club_exchange($1, $2, $3::jsonb) as r`,
  [from, to, JSON.stringify({ title: 'Chạy giao lưu Hồ Tây', starts_at: iso(72), location_name: 'Công viên nước Hồ Tây', distance_km: 10, pace_text: '6:00–7:00', message: 'Rất mong gặp các bạn!', ...extra })])

describe('tường CLB Pro + giao lưu CLB (008100)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('ảnh bìa / khẩu hiệu / chủ đề chỉ cho CLB Pro, chỉ ban quản trị', async () => {
    const brand = { cover_url: 'https://x.supabase.co/storage/v1/object/public/club-avatars/c.jpg', tagline: 'Chạy vì niềm vui', theme: 'SUNSET', cover_position: 30 }
    expect(await fails(rpc(db, A_OWN, `select public.set_club_branding($1, $2::jsonb) as r`, [CA, JSON.stringify(brand)]))).toContain('PRO_REQUIRED')
    await db.query(`update public.clubs set plan = 'PRO', pro_until = null where id = $1`, [CA])
    expect(await fails(rpc(db, A_MEM, `select public.set_club_branding($1, $2::jsonb) as r`, [CA, JSON.stringify(brand)]))).toContain('FORBIDDEN')
    expect(await rpc(db, A_OWN, `select public.set_club_branding($1, $2::jsonb) as r`, [CA, JSON.stringify(brand)])).toMatchObject({ theme: 'SUNSET', tagline: 'Chạy vì niềm vui' })
    const row = (await asUser<Row>(db, B_MEM, '/clubs', `select cover_url, cover_position, tagline, theme from public.clubs where id = $1`, [CA])).rows[0]
    expect(row).toMatchObject({ cover_position: 30, theme: 'SUNSET' })
  })

  it('gửi thư mời: chỉ ban quản trị; chặn trùng; bên nhận được báo', async () => {
    expect(await fails(invite(db, A_MEM, CA, CB))).toContain('FORBIDDEN')
    expect(await fails(invite(db, A_OWN, CA, CB, { starts_at: iso(1) }))).toContain('INVALID_TIME_RANGE')
    const x = await invite(db, A_OWN, CA, CB)
    expect(x).toMatchObject({ status: 'PENDING', from: { name: 'Hồ Tây Runners' }, to: { name: 'Long Biên Run' } })
    expect(await fails(invite(db, A_OWN, CA, CB))).toContain('EXCHANGE_PENDING')
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'CLUB_EXCHANGE'`, [B_OWN])).rows).toHaveLength(1)
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'CLUB_EXCHANGE'`, [B_MEM])).rows).toHaveLength(0)
    expect((await rpc<Row>(db, B_MEM, `select public.club_exchanges($1) as r`, [CB])).incoming).toHaveLength(0)   // thành viên chưa thấy thư đang chờ
  })

  it('nhận lời → buổi chạy vào lịch cả hai CLB + bảng tin; huỷ → huỷ cả hai buổi', async () => {
    const x = (await rpc<Row>(db, B_OWN, `select public.club_exchanges($1) as r`, [CB])).incoming[0]
    expect(await fails(rpc(db, B_MEM, `select public.respond_club_exchange($1, true) as r`, [x.id]))).toContain('FORBIDDEN')
    const r = await rpc<Row>(db, B_OWN, `select public.respond_club_exchange($1, true, 'Hẹn gặp!') as r`, [x.id])
    expect(r).toMatchObject({ status: 'ACCEPTED', response_note: 'Hẹn gặp!' })
    const ev = (await db.query<Row>(`select club_id, title, location_name, status from public.club_events where exchange_id = $1 order by club_id`, [x.id])).rows
    expect(ev).toEqual([
      { club_id: CA, title: 'Giao lưu × Long Biên Run', location_name: 'Công viên nước Hồ Tây', status: 'SCHEDULED' },
      { club_id: CB, title: 'Giao lưu × Hồ Tây Runners', location_name: 'Công viên nước Hồ Tây', status: 'SCHEDULED' },
    ])
    expect((await db.query(`select 1 from public.club_posts where kind = 'ANNOUNCEMENT' and title like 'Giao lưu với%'`)).rows).toHaveLength(2)
    expect((await rpc<Row>(db, B_MEM, `select public.club_exchanges($1) as r`, [CB])).incoming).toHaveLength(1)
    expect(await fails(rpc(db, B_OWN, `select public.respond_club_exchange($1, false) as r`, [x.id]))).toContain('EXCHANGE_CLOSED')
    await rpc(db, B_OWN, `select public.cancel_club_exchange($1, 'Trời mưa bão') as r`, [x.id])
    expect((await db.query<Row>(`select status from public.club_events where exchange_id = $1`, [x.id])).rows.map((e) => e.status)).toEqual(['CANCELLED', 'CANCELLED'])
  })

  it('từ chối kèm lời nhắn → bên mời được báo', async () => {
    const x = await invite(db, A_OWN, CA, CB, { title: 'Lần hai' })
    await rpc(db, B_OWN, `select public.respond_club_exchange($1, false, 'Tháng này bận giải') as r`, [x.id])
    expect((await db.query<Row>(`select title from public.notifications where user_id = $1 and kind = 'CLUB_EXCHANGE' order by created_at desc`, [A_OWN])).rows[0].title)
      .toContain('chưa nhận lời')
  })
})
