import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 007500: CLB Pro bật tay → báo giá tạo thử thách từng lỗi 'record "c" is not assigned yet' (NO BEER NO RUN, 09/2026)
const ADM = '00000000-0000-0000-0000-0000000075a1'
const OWN = '00000000-0000-0000-0000-0000000075a2'
const USR = '00000000-0000-0000-0000-0000000075a3'
const CLUB = '00000000-0000-0000-0000-0000000075c1'
type Row = Record<string, any>

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${ADM}', 'a75@x.vn'), ('${OWN}', 'o75@x.vn'), ('${USR}', 'u75@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${ADM}', 'Admin', 0, 0, 1, now()), ('${OWN}', 'Chủ nhiệm', 0, 0, 1, now()), ('${USR}', 'Runner', 0, 0, 1, now()) on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'NO BEER NO RUN', '${OWN}', 'nbnr75');
    insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${OWN}', 'OWNER', 'APPROVED') on conflict do nothing;
  `)
}
const quote = async (db: PGlite, uid: string, slots: number, club: string | null, format = 'RANKED') =>
  (await asUser<{ r: Row }>(db, uid, '/rpc', `select public.quote_challenge($1, $2, $3) as r`, [slots, format, club])).rows[0].r

describe('báo giá thử thách cho CLB Pro bật tay (007500)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
    await asUser(db, ADM, '/rpc', `select public.admin_set_club_plan($1, 'PRO', null, 'CLB ADMIN') as r`, [CLUB])
  }, 240_000)

  it('chủ nhiệm và admin báo giá được; có lượt CLB Pro → không mất phí, biết tên gói', async () => {
    for (const uid of [OWN, ADM]) {
      const q = await quote(db, uid, 50, CLUB)
      expect(q).toMatchObject({ payer: 'CLUB', plan: { code: 'CLUB_PRO' } })
      expect(Number(q.best_pass_slots)).toBeGreaterThan(0)
    }
    const q = await quote(db, OWN, 20, CLUB)
    expect(q.pass).not.toBeNull()
    expect(q.pass.note).toContain('CLB Pro')
    expect((await quote(db, OWN, 1, CLUB, 'SOLO_GOAL')).fee).toBe(0)
  })

  it('người không có gói: plan null, không có lượt', async () => {
    const q = await quote(db, USR, 50, null)
    expect(q).toMatchObject({ payer: 'USER', plan: null, pass: null })
    expect(Number(q.best_pass_slots)).toBe(0)
  })
})
