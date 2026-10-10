import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 015200: lưu & hiển thị tài khoản Strava đã liên kết (tên, username, ảnh)
const ADM = '00000000-0000-0000-0000-000000015201'
const U = '00000000-0000-0000-0000-000000015202'
const OTHER = '00000000-0000-0000-0000-000000015203'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${ADM}', 'a@x.vn'), ('${U}', 'u@x.vn'), ('${OTHER}', 'o@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${ADM}', 'Admin', 0, 0, 1, now()), ('${U}', 'U', 0, 0, 1, now()), ('${OTHER}', 'O', 0, 0, 1, now());
  `)
}

describe('tài khoản Strava đã liên kết (015200)', () => {
  let db: PGlite
  const asService = async <T>(sql: string, params: unknown[]) => {
    await db.exec('set role service_role')
    try { return await db.query<T>(sql, params) } finally { await db.exec('reset role') }
  }
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, seed, until: '20261001015200' })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
  }, 240_000)

  it('lưu tên / username / ảnh https khi nối; người dùng xem được, người khác không', async () => {
    await asService(`select public.link_provider_connection($1, 'STRAVA', '777', 't', 'r', now() + interval '6 hours', null,
      $2::jsonb)`, [U, JSON.stringify({ name: 'Nguyễn Văn A', username: 'vana', avatar_url: 'https://dgalywyr863hv.cloudfront.net/a.jpg' })])
    const mine = await asUser<Record<string, unknown>>(db, U, '/rpc/my_provider_connections', `select * from public.my_provider_connections()`)
    expect(mine.rows).toEqual([expect.objectContaining({
      provider_user_id: '777', external_name: 'Nguyễn Văn A', external_username: 'vana', external_avatar_url: 'https://dgalywyr863hv.cloudfront.net/a.jpg' })])
    expect(Object.keys(mine.rows[0])).not.toContain('access_token')
    expect((await asUser(db, OTHER, '/rpc/my_provider_connections', `select * from public.my_provider_connections()`)).rows).toHaveLength(0)
  })

  it('bỏ ảnh không phải https; set_provider_identity bổ sung cho kết nối cũ; người dùng không tự gọi được', async () => {
    await asService(`select public.link_provider_connection($1, 'STRAVA', '777', 't', 'r', now() + interval '6 hours')`, [U])
    let r = await db.query<{ external_name: string | null; identity_synced_at: string | null }>(`select external_name, identity_synced_at from public.connected_accounts where user_id = $1`, [U])
    expect(r.rows[0]).toEqual({ external_name: null, identity_synced_at: null })
    await asService(`select public.set_provider_identity($1, 'STRAVA', $2::jsonb)`, [U, JSON.stringify({ name: ' B ', avatar_url: 'http://x/y.jpg' })])
    r = await db.query(`select external_name, external_avatar_url, identity_synced_at from public.connected_accounts where user_id = $1`, [U])
    expect(r.rows[0]).toMatchObject({ external_name: 'B', external_avatar_url: null })
    expect(r.rows[0].identity_synced_at).not.toBeNull()
    await expect(asUser(db, U, '/rpc/set_provider_identity', `select public.set_provider_identity($1, 'STRAVA', '{}'::jsonb)`, [U])).rejects.toThrow(/permission denied/)
  })

  it('admin_user_detail trả tài khoản Strava; người thường không gọi được', async () => {
    const d = await asUser<{ r: { strava: Record<string, unknown> | null; strava_connected: boolean } }>(db, ADM, '/rpc/admin_user_detail', `select public.admin_user_detail($1) as r`, [U])
    expect(d.rows[0].r.strava).toMatchObject({ athlete_id: '777', name: 'B' })
    const none = await asUser<{ r: { strava: unknown } }>(db, ADM, '/rpc/admin_user_detail', `select public.admin_user_detail($1) as r`, [OTHER])
    expect(none.rows[0].r.strava).toBeNull()
    await expect(asUser(db, U, '/rpc/admin_user_detail', `select public.admin_user_detail($1)`, [OTHER])).rejects.toThrow()
  })
})
