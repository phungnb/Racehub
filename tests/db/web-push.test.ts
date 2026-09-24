import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 001700: Web Push — thiết bị, cài đặt loại thông báo / giờ yên lặng, hàng đợi gửi
const U = '00000000-0000-0000-0000-0000000000d1'
const V = '00000000-0000-0000-0000-0000000000d2'
const EP = 'https://fcm.googleapis.com/fcm/send/abc123'
const KEY = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${U}', 'u@x.vn'), ('${V}', 'v@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${U}', 'Minh', 0, 0, 1, now()), ('${V}', 'Lan', 0, 0, 1, now()) on conflict do nothing;
  `)
}

const rpc = async <T = Record<string, unknown>>(db: PGlite, uid: string, sql: string, params: unknown[] = []) =>
  (await asUser<T>(db, uid, '/rpc', sql, params)).rows
const fails = async (db: PGlite, uid: string, sql: string, params: unknown[] = []) => {
  try { await asUser(db, uid, '/rpc', sql, params) } catch (e) { return (e as Error).message }
  return 'OK'
}
const queued = async (db: PGlite) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from private.push_queue where claimed_at is null`)).rows[0].n
const notify = (db: PGlite, user: string, kind: string) =>
  db.query(`select private.notify($1, null, $2, 'Tiêu đề', 'Nội dung', '/feed')`, [user, kind])

describe('Web Push (001700)', () => {
  let db: PGlite
  let token: string
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    // Tắt giờ yên lặng mặc định để test không phụ thuộc giờ chạy
    await rpc(db, U, `select public.update_push_settings($1::jsonb)`, [JSON.stringify({ quiet: false })])
  }, 240_000)

  it('lưu thiết bị: kiểm tra định dạng; cùng máy đổi tài khoản thì chuyển chủ', async () => {
    expect(await fails(db, U, `select public.save_push_subscription('http://x', $1, 'authsecret1')`, [KEY])).toContain('INVALID_SUBSCRIPTION')
    await rpc(db, V, `select public.save_push_subscription($1, $2, 'authsecret1', 'Chrome')`, [EP, KEY])
    await rpc(db, U, `select public.save_push_subscription($1, $2, 'authsecret1', 'Chrome')`, [EP, KEY])
    const own = await db.query(`select user_id from public.push_subscriptions`)
    expect(own.rows).toEqual([{ user_id: U }])
    // Người khác không đọc được thiết bị của tôi; không ghi thẳng vào bảng được
    expect(await rpc(db, V, `select * from public.push_subscriptions`)).toEqual([])
    expect(await fails(db, U, `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://y', $2, 'authsecret1')`, [U, KEY]))
      .toMatch(/permission denied/)
  })

  it('chỉ xếp hàng khi người nhận có thiết bị và bật loại thông báo đó', async () => {
    await notify(db, V, 'CLUB_EVENT')                // V không có thiết bị
    expect(await queued(db)).toBe(0)
    await notify(db, U, 'CLUB_EVENT')
    expect(await queued(db)).toBe(1)
    await rpc(db, U, `select public.update_push_settings($1::jsonb)`, [JSON.stringify({ quiet: false, social: false })])
    await notify(db, U, 'POST_COMMENT')              // đã tắt nhóm "cổ vũ, bình luận"
    await notify(db, U, 'BADGE')
    expect(await queued(db)).toBe(2)
    const s = (await rpc<{ r: Record<string, unknown> }>(db, U, `select public.my_push_settings() as r`))[0].r
    expect(s).toMatchObject({ social: false, club: true, devices: 1, configured: false })
  })

  it('giờ yên lặng: tính theo giờ VN, khoảng qua nửa đêm', async () => {
    const q = async (from: number, to: number, at: string) =>
      (await db.query<{ r: boolean }>(`select private.in_quiet_hours($1::smallint, $2::smallint, $3::timestamptz) as r`, [from, to, at])).rows[0].r
    expect(await q(22, 6, '2026-09-24T16:30:00Z')).toBe(true)    // 23:30 VN
    expect(await q(22, 6, '2026-09-24T22:59:00Z')).toBe(true)    // 05:59 VN
    expect(await q(22, 6, '2026-09-24T23:00:00Z')).toBe(false)   // 06:00 VN
    expect(await q(13, 14, '2026-09-24T06:10:00Z')).toBe(true)   // 13:10 VN
    expect(await q(8, 8, '2026-09-24T01:00:00Z')).toBe(false)
  })

  it('route gửi push: cần khóa bí mật; lấy lô kèm thiết bị + số chưa đọc; xóa thiết bị hết hạn', async () => {
    const msg = (await db.query<{ r: string }>(`select private.configure_push('https://racehub.vn/api/push/dispatch') as r`)).rows[0].r
    expect(msg).toContain('pg_net chưa bật')
    token = (await db.query<{ value: string }>(`select value from private.app_settings where key = 'push_secret'`)).rows[0].value
    expect(token).toMatch(/^[0-9a-f]{48}$/)
    await expect(db.query(`select public.push_claim_batch('sai')`)).rejects.toThrow(/UNAUTHORIZED/)
    expect(await fails(db, U, `select public.push_claim_batch($1)`, [token])).toMatch(/permission denied/)

    const batch = (await db.query<{ r: { user_id: string; kind: string; unread: number; subscriptions: { endpoint: string }[] }[] }>(
      `select public.push_claim_batch($1) as r`, [token])).rows[0].r
    expect(batch.map((b) => b.kind)).toEqual(['CLUB_EVENT', 'BADGE'])
    expect(batch[0]).toMatchObject({ user_id: U, subscriptions: [{ endpoint: EP }] })
    expect(batch[0].unread).toBeGreaterThanOrEqual(3)
    expect(await queued(db)).toBe(0)                  // đã lấy thì không lấy lại
    expect((await db.query<{ r: unknown[] }>(`select public.push_claim_batch($1) as r`, [token])).rows[0].r).toEqual([])

    expect((await db.query<{ r: number }>(`select public.push_report($1, array[$2]) as r`, [token, EP])).rows[0].r).toBe(1)
    expect((await db.query(`select 1 from public.push_subscriptions`)).rows).toHaveLength(0)
  })

  it('gửi thử: luôn gửi kể cả giờ yên lặng, chặn bấm liên tục', async () => {
    await rpc(db, U, `select public.save_push_subscription($1, $2, 'authsecret1')`, [EP, KEY])
    const h = (new Date().getUTCHours() + 7) % 24         // giờ VN hiện tại → đang trong giờ yên lặng
    await rpc(db, U, `select public.update_push_settings($1::jsonb)`, [JSON.stringify({ quiet: true, quiet_from: h, quiet_to: (h + 1) % 24 })])
    await rpc(db, U, `select public.send_test_push()`)
    expect(await queued(db)).toBe(1)
    expect(await fails(db, U, `select public.send_test_push()`)).toContain('TOO_SOON')
    await notify(db, U, 'CLUB_EVENT')                // đang trong giờ yên lặng → không đẩy (vẫn có trong chuông)
    expect(await queued(db)).toBe(1)
  })
})
