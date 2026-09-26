import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 006900: lỗi ở chuỗi thông báo / push không được làm hỏng thao tác chính (sự cố gán CLB Pro 09/2026)
const ADM = '00000000-0000-0000-0000-0000000069a1'
const CAP = '00000000-0000-0000-0000-0000000069a2'
const CLUB = '00000000-0000-0000-0000-0000000069c1'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${ADM}', 'a69@x.vn'), ('${CAP}', 'c69@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${ADM}', 'Admin', 0, 0, 1, now()), ('${CAP}', 'Captain', 0, 0, 1, now())
      on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'NO BEER NO RUN', '${ADM}', 'nb6901');
    insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${ADM}', 'OWNER', 'APPROVED'), ('${CLUB}', '${CAP}', 'MEMBER', 'APPROVED')
      on conflict do nothing;
  `)
}

describe('thông báo không chặn thao tác chính (006900)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
    await db.query(`update public.club_members set role = 'CAPTAIN' where club_id = $1 and user_id = $2`, [CLUB, CAP])
    await db.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/1', repeat('k', 30), repeat('a', 16))`, [CAP])
    await db.query(`insert into public.push_settings (user_id, quiet) values ($1, false)`, [CAP])     // không phụ thuộc giờ yên lặng
  }, 240_000)

  it('hàng đợi push hỏng → gán Pro vẫn thành công, lỗi được ghi lại cho admin xem', async () => {
    await db.exec(`alter table private.push_queue rename to push_queue_broken`)
    try {
      const r = await asUser<{ r: { plan: string } }>(db, ADM, '/rpc',
        `select public.admin_set_club_plan($1, 'PRO', now() + interval '30 days', 'tặng CLB') as r`, [CLUB])
      expect(r.rows[0].r.plan).toBe('PRO')
      // thông báo trong app vẫn tới (chỉ push hỏng)
      expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'CLUB_PRO'`, [CAP])).rows).toHaveLength(1)
      const errs = (await asUser<{ r: { stage: string }[] }>(db, ADM, '/rpc', `select public.admin_notify_errors() as r`)).rows[0].r
      expect(errs[0]).toMatchObject({ stage: 'push_queue' })
    } finally {
      await db.exec(`alter table private.push_queue_broken rename to push_queue`)
    }
  })

  it('bảng thông báo hỏng → thao tác chính vẫn chạy; người thường không xem được nhật ký lỗi', async () => {
    await db.exec(`alter table public.notifications rename to notifications_broken`)
    try {
      const r = await asUser<{ r: { plan: string } }>(db, ADM, '/rpc',
        `select public.admin_set_club_plan($1, 'FREE', null, 'về miễn phí') as r`, [CLUB])
      expect(r.rows[0].r.plan).toBe('FREE')
    } finally {
      await db.exec(`alter table public.notifications_broken rename to notifications`)
    }
    await expect(asUser(db, CAP, '/rpc', `select public.admin_notify_errors() as r`)).rejects.toThrow(/FORBIDDEN/)
  })
})
