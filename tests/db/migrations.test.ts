import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import fs from 'node:fs'
import path from 'node:path'

// Chạy tất cả migration lên schema giả lập, rồi thử các kịch bản tấn công/nghiệp vụ.
const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations')
const ALICE = '00000000-0000-0000-0000-00000000000a'
const BOB = '00000000-0000-0000-0000-00000000000b'
const ADMIN = '00000000-0000-0000-0000-0000000000ad'

let db: PGlite

/** Giả lập một request PostgREST của user đã đăng nhập */
async function asUser<T>(uid: string | null, reqPath: string, sql: string, params: unknown[] = []) {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claims', $1, false), set_config('request.path', $2, false)`,
    [uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : '', reqPath])
  await db.exec(uid ? 'set role authenticated' : 'set role anon')
  try {
    return await db.query<T>(sql, params)
  } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.path', '', false)`)
  }
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(fs.readFileSync(path.join(__dirname, 'legacy_fixture.sql'), 'utf8'))
  await db.exec(`
    insert into auth.users values ('${ALICE}','alice@x.vn','{}'), ('${BOB}','bob@x.vn','{}');
    insert into public.profiles (id, display_name, xu, strava_access_token, strava_refresh_token, strava_token_expires_at, strava_athlete_id, strava_connected)
      values ('${ALICE}','Alice', 100, 'tokA', 'refA', 1893456000, '111', true);
    insert into auth.users values ('${ADMIN}','admin@x.vn','{}');
    insert into public.profiles (id, display_name, role) values ('${ADMIN}', 'Admin', 'SYSTEM_ADMIN');
  `)
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f >= '20261001').sort()
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8').replace(/notify pgrst[^;]*;/g, '')
    await db.exec(sql)
  }
  // Chạy lại lần 2: migration phải idempotent
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8').replace(/notify pgrst[^;]*;/g, '')
    await db.exec(sql)
  }
}, 60_000)

describe('guard chống ghi trực tiếp', () => {
  it('chặn user tự cộng Xu qua REST /profiles', async () => {
    await expect(asUser(ALICE, '/profiles', `update public.profiles set xu = 999999 where id = $1`, [ALICE]))
      .rejects.toThrow(/PROTECTED_COLUMN/)
  })

  it('vẫn cho phép đổi tên hiển thị qua REST', async () => {
    await asUser(ALICE, '/profiles', `update public.profiles set display_name = 'Alice Runner' where id = $1`, [ALICE])
    const r = await db.query<{ display_name: string }>(`select display_name from public.profiles where id = $1`, [ALICE])
    expect(r.rows[0].display_name).toBe('Alice Runner')
  })

  it('chặn tự tạo hồ sơ với số Xu tùy ý', async () => {
    await db.exec(`insert into auth.users values ('00000000-0000-0000-0000-0000000000cc','c@x.vn','{}') on conflict do nothing`)
    await db.exec(`delete from public.profiles where id = '00000000-0000-0000-0000-0000000000cc'`)
    await expect(asUser('00000000-0000-0000-0000-0000000000cc', '/profiles',
      `insert into public.profiles (id, display_name, xu) values ($1, 'C', 1000000)`, ['00000000-0000-0000-0000-0000000000cc']))
      .rejects.toThrow(/PROTECTED_COLUMN/)
  })

  it('upsert user_avatar chỉ có gender vẫn chạy, nhưng không sửa được coins', async () => {
    await asUser(ALICE, '/user_avatar',
      `insert into public.user_avatar (user_id, gender) values ($1, 'female')
       on conflict (user_id) do update set gender = excluded.gender`, [ALICE])
    await asUser(ALICE, '/user_avatar',
      `insert into public.user_avatar (user_id, gender) values ($1, 'male')
       on conflict (user_id) do update set gender = excluded.gender`, [ALICE])
    await expect(asUser(ALICE, '/user_avatar', `update public.user_avatar set coins = 99999 where user_id = $1`, [ALICE]))
      .rejects.toThrow(/PROTECTED_COLUMN/)
  })

  it('chặn ghi trực tiếp activities và cấu hình hệ thống', async () => {
    await expect(asUser(ALICE, '/activities', `insert into public.activities (user_id, distance_m) values ($1, 42195)`, [ALICE]))
      .rejects.toThrow(/DIRECT_WRITE_FORBIDDEN/)
    await expect(asUser(ALICE, '/system_config_versions',
      `insert into public.system_config_versions (config_key, config_value) values ('economy_global_config', '{}')`))
      .rejects.toThrow(/DIRECT_WRITE_FORBIDDEN/)
  })

  it('chặn tự phong OWNER khi chèn club_members', async () => {
    await expect(asUser(ALICE, '/club_members',
      `insert into public.club_members (club_id, user_id, role, status) values (gen_random_uuid(), $1, 'OWNER', 'APPROVED')`, [ALICE]))
      .rejects.toThrow(/PROTECTED_COLUMN/)
  })

  it('RPC cũ dạng INVOKER cập nhật xu vẫn hoạt động', async () => {
    await asUser(ALICE, '/rpc/contribute_treasury', `select public.contribute_treasury(gen_random_uuid(), 10)`)
    const r = await db.query<{ xu: string }>(`select xu from public.profiles where id = $1`, [ALICE])
    expect(Number(r.rows[0].xu)).toBe(90)
  })
})

describe('ensure_profile', () => {
  it('tạo hồ sơ với 500 Xu do server đặt, gọi lại không nhân đôi', async () => {
    await asUser(BOB, '/rpc/ensure_profile', `select public.ensure_profile()`)
    await asUser(BOB, '/rpc/ensure_profile', `select public.ensure_profile()`)
    const r = await db.query<{ xu: string; display_name: string }>(`select xu, display_name from public.profiles where id = $1`, [BOB])
    expect(r.rows).toHaveLength(1)
    expect(Number(r.rows[0].xu)).toBe(500)
    expect(r.rows[0].display_name).toBe('bob')
  })

  it('user mới đăng ký tự có hồ sơ (trigger)', async () => {
    const id = '00000000-0000-0000-0000-0000000000dd'
    await db.query(`insert into auth.users values ($1, 'dan@x.vn', '{"full_name":"Dan"}')`, [id])
    const r = await db.query<{ display_name: string }>(`select display_name from public.profiles where id = $1`, [id])
    expect(r.rows[0].display_name).toBe('Dan')
  })

  it('khách chưa đăng nhập không gọi được', async () => {
    await expect(asUser(null, '/rpc/ensure_profile', `select public.ensure_profile()`)).rejects.toThrow()
  })
})

describe('kết nối Strava', () => {
  it('đã chuyển token cũ sang private và xóa khỏi profiles', async () => {
    const p = await db.query<{ strava_access_token: string | null; strava_connected: boolean }>(
      `select strava_access_token, strava_connected from public.profiles where id = $1`, [ALICE])
    expect(p.rows[0].strava_access_token).toBeNull()
    expect(p.rows[0].strava_connected).toBe(true)
    const c = await db.query<{ access_token: string; expires_at: string }>(
      `select access_token, expires_at from private.provider_connections where user_id = $1`, [ALICE])
    expect(c.rows[0].access_token).toBe('tokA')
    expect(c.rows[0].expires_at).not.toBeNull()
  })

  it('client không đọc được bảng token, chỉ thấy view my_connections', async () => {
    await expect(asUser(ALICE, '/provider_connections', `select * from private.provider_connections`)).rejects.toThrow()
    const r = await asUser<{ provider: string }>(ALICE, '/my_connections', `select * from public.my_connections`)
    expect(r.rows).toEqual([expect.objectContaining({ provider: 'STRAVA', external_user_id: '111' })])
    expect(Object.keys(r.rows[0])).not.toContain('access_token')
  })

  it('client không gọi được link_provider_connection', async () => {
    await expect(asUser(ALICE, '/rpc/link_provider_connection',
      `select public.link_provider_connection($1, 'STRAVA', '999', 't', 'r', now())`, [ALICE])).rejects.toThrow()
  })

  it('service role liên kết được; tài khoản Strava đã thuộc người khác thì báo xung đột', async () => {
    await db.exec('set role service_role')
    await expect(db.query(`select public.link_provider_connection($1, 'STRAVA', '111', 't', 'r', now())`, [BOB]))
      .rejects.toThrow(/PROVIDER_ACCOUNT_CONFLICT/)
    await db.query(`select public.link_provider_connection($1, 'STRAVA', '222', 't2', 'r2', now())`, [BOB])
    const tok = await db.query<{ t: string }>(`select public.unlink_provider_connection($1, 'STRAVA') as t`, [BOB])
    expect(tok.rows[0].t).toBe('t2')
    await db.exec('reset role')
  })
})

describe('RPC quản trị', () => {
  it('user thường không duyệt bài / sửa cấu hình được, admin thì được', async () => {
    const act = await db.query<{ id: string }>(`insert into public.activities (user_id, distance_m) values ($1, 5000) returning id`, [ALICE])
    const id = act.rows[0].id
    await expect(asUser(ALICE, '/rpc/review_activity', `select public.review_activity($1, 'APPROVED')`, [id])).rejects.toThrow(/FORBIDDEN/)
    await asUser(ADMIN, '/rpc/review_activity', `select public.review_activity($1, 'APPROVED')`, [id])
    const r = await db.query<{ validation_status: string; status: string }>(`select validation_status, status from public.activities where id = $1`, [id])
    expect(r.rows[0]).toEqual({ validation_status: 'APPROVED', status: 'COMPLETED' })

    await expect(asUser(ALICE, '/rpc/admin_publish_config', `select public.admin_publish_config('economy_global_config', '{"kmRate":1}')`))
      .rejects.toThrow(/FORBIDDEN/)
    await asUser(ADMIN, '/rpc/admin_publish_config', `select public.admin_publish_config('economy_global_config', '{"kmRate":1}')`)
    const c = await db.query<{ config_value: { kmRate: number } }>(`select config_value from public.system_config_versions`)
    expect(c.rows[0].config_value.kmRate).toBe(1)
  })
})

describe('RPC bỏ p_user_id', () => {
  it('equip_item dùng auth.uid(), không nhận p_user_id nữa', async () => {
    const r = await asUser<{ r: { user: string } }>(ALICE, '/rpc/equip_item', `select public.equip_item(p_item_id => gen_random_uuid()) as r`)
    expect(r.rows[0].r.user).toBe(ALICE)
    await expect(asUser(ALICE, '/rpc/equip_item', `select public.equip_item(p_user_id => $1, p_item_id => gen_random_uuid())`, [BOB]))
      .rejects.toThrow()
  })

  it('submit_and_process_activity ghi cho chính người gọi', async () => {
    const r = await asUser<{ r: { user: string } }>(ALICE, '/rpc/submit_and_process_activity',
      `select public.submit_and_process_activity(p_title => 'x', p_source => 'DIRECT_GPS', p_started_at => now(), p_ended_at => now(),
        p_elapsed_s => 60, p_moving_s => 60, p_distance_m => 200, p_avg_pace_s => 300, p_track_points => '[]') as r`)
    expect(r.rows[0].r.user).toBe(ALICE)
  })

  it('has_permission có overload 2 tham số', async () => {
    const r = await asUser<{ ok: boolean }>(ALICE, '/rpc/has_permission', `select public.has_permission(p_club_id => gen_random_uuid(), p_permission_code => 'x') as ok`)
    expect(r.rows[0].ok).toBe(true)
  })

  it('không đăng nhập thì bị từ chối', async () => {
    await expect(asUser(null, '/rpc/equip_item', `select public.equip_item(p_item_id => gen_random_uuid())`)).rejects.toThrow()
  })
})
