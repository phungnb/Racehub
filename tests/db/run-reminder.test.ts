import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb } from './load-schema'

// Migration 013600: nhắc runner có bài hợp lệ gần nhất cách 3–30 ngày, mỗi người tối đa 1 lần / 7 ngày
const id = (n: number) => `00000000-0000-0000-0000-0000000136${String(n).padStart(2, '0')}`
const [RECENT, STALE, LONG_GONE, BANNED, NEW_USER] = [1, 2, 3, 4, 5].map(id)

async function seed(db: PGlite) {
  const all = [RECENT, STALE, LONG_GONE, BANNED, NEW_USER]
  await db.exec(`
    insert into auth.users (id, email) values ${all.map((u, i) => `('${u}', 'u${i}@q136.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${all.map((u, i) => `('${u}', 'Người ${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
const run = (db: PGlite, user: string, daysAgo: number) => db.exec(`
  insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
  values ('${user}', 'Chạy', 'STRAVA', now() - interval '${daysAgo} days', now() - interval '${daysAgo} days' + interval '30 minutes', 5000, 5000, 1800, 360, 'APPROVED', 'READY')`)
const count = async (db: PGlite, user: string) =>
  (await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'RUN_REMINDER'`, [user])).rows.length
const send = async (db: PGlite) => ((await db.query<{ n: number }>(`select public.send_run_reminders() as n`)).rows[0].n)

describe('nhắc runner chưa chạy (013600)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.exec(`update public.profiles set banned_at = now() where id = '${BANNED}'`)
    await run(db, RECENT, 1); await run(db, STALE, 4); await run(db, LONG_GONE, 45); await run(db, BANNED, 4)
  }, 240_000)

  it('chỉ nhắc người có bài gần nhất cách 3–30 ngày, không nhắc người bị khoá / mới chưa chạy / nghỉ quá lâu', async () => {
    expect(await send(db)).toBe(1)
    expect([await count(db, RECENT), await count(db, STALE), await count(db, LONG_GONE), await count(db, BANNED), await count(db, NEW_USER)]).toEqual([0, 1, 0, 0, 0])
  })

  it('gọi lại không nhắc thêm trong 7 ngày; sau 7 ngày thì nhắc lại', async () => {
    expect(await send(db)).toBe(0)
    await db.exec(`update public.notifications set created_at = now() - interval '8 days' where kind = 'RUN_REMINDER'`)
    expect(await send(db)).toBe(1)
    expect(await count(db, STALE)).toBe(2)
  })
})
