import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 012000: thử thách theo mục tiêu — tham gia bắt buộc kèm mục tiêu, trong cùng một giao dịch
const U = Array.from({ length: 3 }, (_, i) => `00000000-0000-0000-0000-0000000012a${i}`)
const [A, B, C] = U

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ${U.map((u, i) => `('${u}', 'q${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${U.map((u, i) => `('${u}', 'Runner ${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
type Row = Record<string, unknown>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) =>
  (await asUser<T>(db, uid, '/rpc', sql, params)).rows
const fails = async (db: PGlite, uid: string, sql: string, params: unknown[] = []) => {
  try { await asUser(db, uid, '/rpc', sql, params) } catch (e) { return (e as Error).message }
  return 'OK'
}
const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
const part = async (db: PGlite, cid: string, uid: string) =>
  (await db.query<{ status: string; pledge_km: string | null }>(
    `select status, pledge_km from public.challenge_participants where challenge_id = $1 and profile_id = $2`, [cid, uid])).rows[0]

describe('Tham gia thử thách theo mục tiêu bắt buộc kèm mục tiêu (012000)', () => {
  let db: PGlite
  let cid: string, plain: string
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`select private.ledger_post('TEST_SEED', 'seed:pledge-req', 'seed', null,
      jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', 5000),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -5000)))`, [A])
    const mk = async (title: string, key: string) =>
      (await rpc<{ r: { challenge_id: string } }>(db, A, `select public.create_challenge_v2($1::jsonb, $2) as r`,
        [JSON.stringify({ title, format: 'SOLO_GOAL', objective: 'DISTANCE', target_value: 21, start_date: iso(-1), end_date: iso(24 * 6), max_slots: 20 }), key]))[0].r.challenge_id
    cid = await mk('Tuần mục tiêu', 'pledge-required-key-1')
    plain = await mk('Thường', 'pledge-required-key-2')
    await rpc(db, A, `select public.set_challenge_pledge($1, '{"options":[21,42]}'::jsonb)`, [cid])
  }, 240_000)

  it('vào + đặt mục tiêu trong một bước', async () => {
    const r = (await rpc<{ r: { pledge_km: number } }>(db, B, `select public.join_challenge_pledge($1, 42) as r`, [cid]))[0].r
    expect(Number(r.pledge_km)).toBe(42)
    const p = await part(db, cid, B)
    expect(p.status).toBe('JOINED')
    expect(Number(p.pledge_km)).toBe(42)
  })

  it('mục tiêu sai / thiếu → không vào được (không còn người tham gia mà chưa có mục tiêu)', async () => {
    expect(await fails(db, C, `select public.join_challenge_pledge($1, 30)`, [cid])).toContain('INVALID_PLEDGE')
    expect(await fails(db, C, `select public.join_challenge_pledge($1, null)`, [cid])).toContain('PLEDGE_REQUIRED')
    expect(await part(db, cid, C)).toBeUndefined()
  })

  it('thử thách không có mục tiêu → báo lỗi, khách chưa đăng nhập không gọi được', async () => {
    expect(await fails(db, C, `select public.join_challenge_pledge($1, 21)`, [plain])).toContain('PLEDGE_NOT_SUPPORTED')
    const anon = await db.query<{ ok: boolean }>(`select has_function_privilege('anon', 'public.join_challenge_pledge(uuid,numeric,text)', 'execute') as ok`)
    expect(anon.rows[0].ok).toBe(false)
  })
})
