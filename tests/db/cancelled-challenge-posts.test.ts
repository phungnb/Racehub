import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 011200: thử thách bị hủy → bài "thử thách mới" trên bảng tin CLB tự ẩn (không còn ở trang chủ)
const [U, ADM] = ['00000000-0000-0000-0000-0000001120a1', '00000000-0000-0000-0000-0000001120a2']
const CH = '00000000-0000-0000-0000-0000001120c1'
async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${U}', 'u112@x.vn'), ('${ADM}', 'a112@x.vn');
    insert into public.profiles (id, display_name) values ('${U}', 'U'), ('${ADM}', 'A') on conflict do nothing;
    update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADM}';
  `)
}

describe('thử thách đã hủy (011200)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 300_000)

  it('hủy thử thách → bài trên bảng tin CLB ẩn, bảng tin cộng đồng không còn', async () => {
    const club = (await asUser<{ r: { id: string } }>(db, U, '/rpc', `select public.create_club('CLB 112', 'x') as r`)).rows[0].r
    await db.query(`insert into public.challenges (id, title, start_date, end_date, target_value, target_km, min_km, status, created_by, target_audience)
                    values ($1, 'Thử thách tuần 40', now() - interval '1 day', now() + interval '6 days', 42, 42, 1, 'ACTIVE', $2, 'PUBLIC')`, [CH, U])
    await db.query(`insert into public.club_posts (club_id, author_id, kind, title, body, meta) values ($1, $2, 'CHALLENGE', 'Thử thách tuần 40', '', jsonb_build_object('challenge_id', $3::uuid))`, [club.id, U, CH])
    const feed = async () => (await asUser<{ r: { kind: string }[] }>(db, U, '/rpc', `select public.community_feed() as r`)).rows[0].r
    expect((await feed()).filter((p) => p.kind === 'CHALLENGE')).toHaveLength(1)
    await db.query(`update public.challenges set status = 'CANCELLED' where id = $1`, [CH])
    expect((await feed()).filter((p) => p.kind === 'CHALLENGE')).toHaveLength(0)
    expect((await db.query(`select 1 from public.club_posts where kind = 'CHALLENGE' and deleted_at is null`)).rows).toHaveLength(0)
  })

  it('admin hệ thống xóa được CLB mình không làm chủ nhiệm (kể cả đang là thành viên thường)', async () => {
    const club = (await asUser<{ r: { id: string } }>(db, U, '/rpc', `select public.create_club('CLB Cũ', 'x') as r`)).rows[0].r
    await db.query(`insert into public.club_members (club_id, user_id, role, status) values ($1, $2, 'MEMBER', 'APPROVED')`, [club.id, ADM])
    await asUser(db, ADM, '/rpc', `select public.delete_club($1, 'clb cũ')`, [club.id])
    expect((await db.query(`select 1 from public.clubs where id = $1`, [club.id])).rows).toHaveLength(0)
  })
})
