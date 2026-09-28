import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 010300: danh sách tài khoản bất thường cho admin
const id = (n: number) => `00000000-0000-0000-0000-0000000103${String(n).padStart(2, '0')}`
const [RUNNER, PHONE1, PHONE2, INVITER, CLEAN, ADM] = [1, 2, 3, 4, 5, 6].map(id)
const FAKES = [7, 8, 9].map(id)
type Risk = { user_id: string; score: number; flags: { code: string; count: number }[]; banned: boolean }

async function seed(db: PGlite) {
  const all = [RUNNER, PHONE1, PHONE2, INVITER, CLEAN, ADM, ...FAKES]
  await db.exec(`
    insert into auth.users (id, email) values ${all.map((u, i) => `('${u}', 'r${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name) values ${all.map((u, i) => `('${u}', 'User ${i}')`).join(', ')} on conflict do nothing;
    update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADM}';
  `)
}

describe('tài khoản bất thường (010300)', () => {
  let db: PGlite
  const risks = async (uid = ADM) => (await asUser<{ r: Risk[] }>(db, uid, '/rpc', `select public.admin_account_risks(30) as r`)).rows[0].r
  const run = async (uid: string, start: string, mins: number, lat: number) => {
    const a = (await db.query<{ id: string }>(`
      insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
      values ($1, 'Chạy', 'DIRECT_GPS', $2::timestamptz, $2::timestamptz + make_interval(mins => $3), 5000, 5000, $3 * 60, 360, 'APPROVED', 'READY') returning id`,
      [uid, start, mins])).rows[0].id
    await db.query(`insert into public.activity_details (activity_id, start_lat, start_lng) values ($1, $2, 105.85)`, [a, lat])
  }
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    // Một tài khoản, hai người: cùng giờ, một ở Hà Nội, một cách 11 km
    const t = new Date(Date.now() - 20 * 3600_000).toISOString()
    await run(RUNNER, t, 40, 21.03)
    await run(RUNNER, t, 30, 21.13)
    // Người chạy bình thường
    await run(CLEAN, new Date(Date.now() - 30 * 3600_000).toISOString(), 40, 21.03)
    // Một điện thoại đăng nhập 2 tài khoản
    const sub = [`https://push.example/dev-1`, 'p'.repeat(40), 'a'.repeat(16)]
    await asUser(db, PHONE1, '/rpc', `select public.save_push_subscription($1, $2, $3)`, sub)
    await asUser(db, PHONE2, '/rpc', `select public.save_push_subscription($1, $2, $3)`, sub)
    // Mời 3 tài khoản đã nhận thưởng giới thiệu nhưng không chạy
    for (const f of FAKES) {
      await db.query(`update public.profiles set referred_by = $1 where id = $2`, [INVITER, f])
      await db.query(`select private.ledger_post('REFERRAL_INVITER', 'referral_inviter:' || $2, 'Thưởng giới thiệu', $2::uuid,
        jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', 20),
                          jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -20)))`, [INVITER, f])
    }
  }, 240_000)

  it('liệt kê đúng người, đúng dấu hiệu; người chạy bình thường không có', async () => {
    const r = await risks()
    const by = (u: string) => r.find((x) => x.user_id === u)
    expect(by(RUNNER)!.flags.map((f) => f.code)).toEqual(expect.arrayContaining(['TWO_PLACES', 'OVERLAP']))
    expect(by(PHONE1)!.flags).toEqual([{ code: 'SHARED_DEVICE', count: 1 }])
    expect(by(PHONE2)).toBeTruthy()
    expect(by(INVITER)!.flags).toEqual([{ code: 'REFERRAL_FARM', count: 3 }])
    expect(by(CLEAN)).toBeUndefined()
    expect(r[0].user_id).toBe(RUNNER)                        // hai nơi cùng lúc: nặng nhất
    expect(r.every((x) => x.score >= 20 && x.score <= 100)).toBe(true)
  })

  it('chỉ admin xem được; mã thiết bị không đọc trực tiếp được', async () => {
    await expect(risks(RUNNER)).rejects.toThrow()
    await expect(asUser(db, PHONE1, '/rest', `select * from private.device_links`)).rejects.toThrow()
  })
})
