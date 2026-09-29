import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 011000: quà tĩnh / quà động, quà theo mốc (5K…Ultra, PR), 45 quà mới
const [A, B, ADM] = [1, 2, 3].map((n) => `00000000-0000-0000-0000-0000001100${String(n).padStart(2, '0')}`)
type Row = Record<string, any>

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${A}', 'a110@x.vn'), ('${B}', 'b110@x.vn'), ('${ADM}', 'adm110@x.vn');
    insert into public.profiles (id, display_name) values ('${A}', 'An'), ('${B}', 'Bình'), ('${ADM}', 'Admin') on conflict do nothing;
    update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADM}';
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
let h = 100
const run = (db: PGlite, uid: string, km: number, paceS: number) => db.query<{ id: string }>(`
  insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
  values ($1, 'Chạy', 'DIRECT_GPS', now() - make_interval(hours => $4), now() - make_interval(hours => $4) + interval '1 hour', $2::numeric, $2::numeric, $3::int, $5::int, 'APPROVED', 'READY')
  returning id`, [uid, km * 1000, Math.round(km * paceS), (h -= 1), paceS]).then((r) => r.rows[0].id)
const send = (db: PGlite, code: string, activity: string | null, key: string) =>
  rpc(db, A, `select public.send_gift($1, $2, 1, null, null, $3, $4) as r`, [B, code, activity, key])

describe('kho quà v2 (011000)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`select private.ledger_post('TEST_SEED', 'k110-seed', 'seed', null,
      jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', 5000),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -5000)))`, [A])
  }, 300_000)

  it('quà có loại tĩnh / động; quà mới có mặt; không có quốc kỳ, bản đồ; siêu tân tinh đang tắt', async () => {
    const cat = await rpc(db, A, `select public.gift_catalog_for(null, null) as r`)
    const by = new Map<string, Row>(cat.gifts.map((g: Row) => [g.code, g]))
    expect(by.get('heart')).toMatchObject({ kind: 'STATIC', price_xu: 2 })
    expect(by.get('rocket')).toMatchObject({ kind: 'ANIMATED' })
    expect(by.get('medal')?.name).toBe('Huy chương vàng')
    expect(by.get('thang_long_dragon')).toMatchObject({ kind: 'ANIMATED', price_xu: 2000 })
    expect(by.has('supernova')).toBe(false)
    expect(by.has('congrats_5k')).toBe(false)                     // quà theo mốc không hiện khi không có bài chạy
    expect([...by.keys()].some((c) => /flag_vn|vietnam|map/.test(c))).toBe(false)
    const n = (await db.query<{ n: number }>(`select count(*)::int n from public.gift_catalog`)).rows[0].n
    expect(n).toBeGreaterThanOrEqual(65)
    // Bản app cũ: không có quà theo mốc
    const old = await rpc(db, A, `select public.gift_catalog() as r`)
    expect(old.gifts.some((g: Row) => g.context)).toBe(false)
  })

  it('quà theo mốc: chỉ hiện và chỉ tặng được trên bài đạt mốc; PR = dài nhất / nhanh nhất', async () => {
    const short = await run(db, B, 3, 360)
    const ten = await run(db, B, 10.2, 330)
    const codes = async (act: string) => (await rpc(db, A, `select public.gift_catalog_for(null, $1) as r`, [act])).gifts
      .filter((g: Row) => g.context).map((g: Row) => g.code).sort()
    expect(await codes(short)).toEqual([])                          // bài đầu tiên, 3 km: chưa có gì để so
    expect(await codes(ten)).toEqual(['congrats_10k', 'congrats_5k', 'pr_flag'])
    expect(await fails(send(db, 'congrats_10k', short, 'k110-gift-1'))).toContain('GIFT_CONTEXT_REQUIRED')
    expect(await fails(send(db, 'congrats_half', ten, 'k110-gift-2'))).toContain('GIFT_CONTEXT_REQUIRED')
    expect(await fails(send(db, 'congrats_5k', null, 'k110-gift-3'))).toContain('GIFT_CONTEXT_REQUIRED')
    const ok = await send(db, 'congrats_10k', ten, 'k110-gift-4')
    expect(ok).toMatchObject({ total_xu: 50, kind: 'STATIC' })
    // Bài 6 km chậm hơn: không phải PR
    const slow = await run(db, B, 6, 400)
    expect(await codes(slow)).toEqual(['congrats_5k'])
    // Bài 6 km nhanh nhất: PR theo pace
    const fast = await run(db, B, 6, 300)
    expect(await codes(fast)).toEqual(['congrats_5k', 'pr_flag'])
  })

  it('admin lưu loại quà, ảnh riêng, mốc; ảnh phải là https', async () => {
    const save = (p: Row) => rpc(db, ADM, `select public.admin_save_gift($1::jsonb) as r`, [JSON.stringify(p)])
    const base = { code: 'test_gift', name: 'Quà thử', emoji: '🎁', price_xu: 40, tier: 'BOOST', vip_tier: 0, is_active: true, sort: 1 }
    await save({ ...base, kind: 'ANIMATED', art_url: 'https://x.supabase.co/storage/v1/object/public/content-media/a.webp', context: 'KM5' })
    const g = (await db.query<Row>(`select kind, art_url, context from public.gift_catalog where code = 'test_gift'`)).rows[0]
    expect(g).toEqual({ kind: 'ANIMATED', art_url: 'https://x.supabase.co/storage/v1/object/public/content-media/a.webp', context: 'KM5' })
    expect(await fails(save({ ...base, art_url: 'javascript:alert(1)' }))).toContain('gift_catalog_art_chk')
    expect(await fails(rpc(db, A, `select public.admin_save_gift($1::jsonb) as r`, [JSON.stringify(base)]))).not.toBe('OK')
  })
})
