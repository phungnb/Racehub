import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 014900: chinh phục — tham gia bắt buộc kèm hạng mục (1 hạng mục không cần mục tiêu riêng thì tự gán)
const U = Array.from({ length: 4 }, (_, i) => `00000000-0000-0000-0000-0000001490${String(i + 1).padStart(2, '0')}`)
const [A, B, C, D] = U
type Row = Record<string, any>

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ${U.map((u, i) => `('${u}', 'c149${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${U.map((u, i) => `('${u}', 'Runner ${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
const rpc = async <T = Row,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
let seq = 0
const entries = async (db: PGlite, cid: string, uid: string) =>
  (await db.query<Row>(`select e.category_id, e.target_s from public.challenge_category_entries e where e.challenge_id = $1 and e.user_id = $2`, [cid, uid])).rows
const joined = async (db: PGlite, cid: string, uid: string) =>
  (await db.query(`select 1 from public.challenge_participants where challenge_id = $1 and profile_id = $2 and status <> 'LEFT'`, [cid, uid])).rows.length > 0

describe('chinh phục: tham gia bắt buộc có hạng mục (014900)', () => {
  let db: PGlite
  const make = async (mode: string, cats: Row[]) => {
    const cid = (await rpc<{ challenge_id: string }>(db, A, `select public.create_challenge_v2($1::jsonb, $2) as r`,
      [JSON.stringify({ title: `Chinh phục ${mode}`, format: 'SOLO_GOAL', objective: 'DISTANCE', target_value: 1, audience: 'PUBLIC',
        start_date: iso(-1), end_date: iso(24 * 6), max_slots: 20 }), `join-conq-key-${++seq}`]))!.challenge_id
    const board = await rpc(db, A, `select public.set_challenge_conquest($1, $2::jsonb) as r`,
      [cid, JSON.stringify({ objective: 'BEST_TIME', mode, categories: cats })])
    return { cid, cats: board.categories as Row[] }
  }
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`select private.ledger_post('TEST_SEED', 'seed-149', 'seed', null,
      jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', 100000),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -100000)))`, [A])
  }, 300_000)

  it('1 hạng mục (ANY): items trống → tự đăng ký hạng mục đó', async () => {
    const { cid, cats } = await make('ANY', [{ label: '5K', distance_km: 5 }])
    await rpc(db, B, `select public.join_challenge_conquest($1, '[]'::jsonb) as r`, [cid])
    expect((await entries(db, cid, B)).map((e) => e.category_id)).toEqual([cats[0].id])
  })

  it('nhiều hạng mục: không chọn → không vào; chọn → vào kèm hạng mục', async () => {
    const { cid, cats } = await make('ANY', [{ label: '5K', distance_km: 5 }, { label: '10K', distance_km: 10 }])
    expect(await fails(rpc(db, C, `select public.join_challenge_conquest($1, '[]'::jsonb) as r`, [cid]))).toContain('CONQUEST_REQUIRED')
    expect(await joined(db, cid, C)).toBe(false)
    await rpc(db, C, `select public.join_challenge_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify([{ category_id: cats[1].id }])])
    expect((await entries(db, cid, C)).map((e) => e.category_id)).toEqual([cats[1].id])
  })

  it('SELF: luôn phải nhập mục tiêu, mục tiêu sai thì hoàn tác cả việc vào', async () => {
    const { cid, cats } = await make('SELF', [{ label: '5K', distance_km: 5 }])
    expect(await fails(rpc(db, D, `select public.join_challenge_conquest($1, '[]'::jsonb) as r`, [cid]))).toContain('CONQUEST_REQUIRED')
    expect(await fails(rpc(db, D, `select public.join_challenge_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify([{ category_id: cats[0].id, target_s: 0 }])]))).toContain('INVALID_CONQUEST')
    expect(await joined(db, cid, D)).toBe(false)
    await rpc(db, D, `select public.join_challenge_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify([{ category_id: cats[0].id, target_s: 1800 }])])
    expect((await entries(db, cid, D))[0].target_s).toBe(1800)
  })

  it('không phải thử thách chinh phục → báo lỗi; khách chưa đăng nhập không gọi được', async () => {
    const plain = (await rpc<{ challenge_id: string }>(db, A, `select public.create_challenge_v2($1::jsonb, $2) as r`,
      [JSON.stringify({ title: 'Thường', format: 'SOLO_GOAL', objective: 'DISTANCE', target_value: 5, audience: 'PUBLIC', start_date: iso(-1), end_date: iso(48), max_slots: 20 }), `join-conq-key-${++seq}`]))!.challenge_id
    expect(await fails(rpc(db, B, `select public.join_challenge_conquest($1, '[]'::jsonb) as r`, [plain]))).toContain('CONQUEST_NOT_SUPPORTED')
    const anon = await db.query<{ ok: boolean }>(`select has_function_privilege('anon', 'public.join_challenge_conquest(uuid,jsonb,text)', 'execute') as ok`)
    expect(anon.rows[0].ok).toBe(false)
  })
})
