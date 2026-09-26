import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 008000: trang công khai CLB Pro — khách xem được, không lộ dữ liệu bài chạy / thành viên
const OWN = '00000000-0000-0000-0000-0000000080a1'
const CLUB = '00000000-0000-0000-0000-0000000080c1'
type Row = Record<string, any>

describe('trang công khai CLB (008000)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed: async (d) => { await d.exec(`
      insert into auth.users (id, email) values ('${OWN}', 'o80@x.vn');
      insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${OWN}', 'Chủ nhiệm', 0, 0, 1, now()) on conflict do nothing;
      insert into public.clubs (id, name, owner_id, invite_code, description) values ('${CLUB}', 'Sài Gòn Runners', '${OWN}', 'sgr8001', 'Chạy sáng Thảo Cầm Viên');
    `) } })
    await db.query(`update public.clubs set slug = 'saigon-runners', plan = 'PRO', pro_until = null where id = $1`, [CLUB])
  }, 240_000)

  const page = async (slug: string) => (await asUser<{ r: Row | null }>(db, null, '/rpc', `select public.club_public_page($1) as r`, [slug])).rows[0].r

  it('khách chưa đăng nhập xem được CLB Pro; chỉ số tổng, không có dữ liệu bài chạy', async () => {
    const c = await page(' Saigon-Runners ')
    expect(c).toMatchObject({ name: 'Sài Gòn Runners', description: 'Chạy sáng Thảo Cầm Viên', slug: 'saigon-runners', events_held: 0, challenges_held: 0 })
    expect(Object.keys(c!).sort()).toEqual(['accent_color', 'avatar_url', 'challenges_held', 'description', 'events_held', 'events_upcoming',
      'founded_at', 'id', 'join_policy', 'member_count', 'name', 'slug'])
  })

  it('hết Pro / sai link → không có trang', async () => {
    expect(await page('khong-co')).toBeNull()
    await db.query(`update public.clubs set pro_until = now() - interval '1 day' where id = $1`, [CLUB])
    expect(await page('saigon-runners')).toBeNull()
  })
})
