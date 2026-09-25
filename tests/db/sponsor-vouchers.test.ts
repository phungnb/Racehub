import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 005200: voucher tài trợ
const id = (n: number) => `00000000-0000-0000-0000-0000000052${String(n).padStart(2, '0')}`
const [ORG, R1, R2, R3, ADM] = [1, 2, 3, 4, 5].map(id)
const CH = '00000000-0000-0000-0000-0000000052d1'

async function seed(db: PGlite) {
  const users = [ORG, R1, R2, R3, ADM]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'v${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'V${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const save = (db: PGlite, uid: string, p: object) => rpc<Row>(db, uid, `select public.save_voucher_campaign($1::jsonb) as r`, [JSON.stringify(p)])
const mine = (db: PGlite, uid: string) => rpc<Row[]>(db, uid, `select public.my_vouchers() as r`)

describe('voucher tài trợ (005200)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
    await db.exec(`
      insert into public.challenges (id, title, start_date, end_date, target_value, target_km, min_km, status, created_by, target_audience)
        values ('${CH}', 'Voucher 50K', now() - interval '3 days', now() + interval '3 days', 50, 50, 1, 'ACTIVE', '${ORG}', 'PUBLIC');
      insert into public.challenge_participants (challenge_id, profile_id, status) values ('${CH}', '${R1}', 'JOINED'), ('${CH}', '${R2}', 'JOINED'), ('${CH}', '${R3}', 'JOINED');
    `)
  }, 240_000)

  it('BTC thử thách tạo chiến dịch; người ngoài không tạo được; hoàn thành khi chưa có mã → dán mã sau thì phát bù', async () => {
    const base = { sponsor_name: 'Shop Giày A', title: 'Giảm 50.000đ giày chạy', target_type: 'CHALLENGE', target_id: CH, code_mode: 'POOL',
      redeem_url: 'https://shop-a.vn/sale' }
    expect(await fails(save(db, R1, base))).toContain('FORBIDDEN')
    expect(await fails(save(db, ORG, { ...base, redeem_url: 'javascript:alert(1)' }))).toContain('INVALID_URL')
    const v = await save(db, ORG, base)
    expect(v).toMatchObject({ issued: 0, remaining: 0, total: 0 })
    await db.query(`update public.challenge_participants set completed_at = now() where challenge_id = $1 and profile_id = $2`, [CH, R1])
    expect(await mine(db, R1)).toEqual([])                                 // chưa có mã trong kho
    const added = await rpc<Row>(db, ORG, `select public.add_voucher_codes($1, $2) as r`, [v.id, ['abc111', 'ABC111', 'abc222', 'x']])
    expect(added).toMatchObject({ added: 2, issued: 1, remaining: 1 })
    const m = await mine(db, R1)
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ sponsor_name: 'Shop Giày A', target_name: 'Voucher 50K' })
    expect(['ABC111', 'ABC222']).toContain(m[0].code)
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'VOUCHER'`, [R1])).rows).toHaveLength(1)
    // hết kho: người thứ 3 không nhận
    await db.query(`update public.challenge_participants set completed_at = now() where challenge_id = $1 and profile_id = any($2)`, [CH, [R2, R3]])
    const counts = [(await mine(db, R2)).length, (await mine(db, R3)).length]
    expect(counts.sort()).toEqual([0, 1])
    // người khác xem chiến dịch: không thấy mã của ai
    const pub = await rpc<Row[]>(db, R3, `select public.list_voucher_campaigns('CHALLENGE', $1) as r`, [CH])
    expect(pub[0]).not.toHaveProperty('shared_code')
    expect(pub[0]).not.toHaveProperty('total')
  })

  it('mã chung cho Top N khi chốt hạng; nhiệm vụ do admin gắn voucher; đánh dấu đã dùng', async () => {
    await save(db, ORG, { sponsor_name: 'Massage B', title: 'Tặng 1 buổi massage', target_type: 'CHALLENGE', target_id: CH,
      condition: 'TOP_N', top_n: 1, code_mode: 'SHARED', shared_code: 'top1-free' })
    await db.query(`update public.challenge_participants set final_rank = case profile_id when $2 then 1 else 2 end where challenge_id = $1`, [CH, R2])
    const r2 = await mine(db, R2)
    expect(r2.find((x: Row) => x.sponsor_name === 'Massage B')?.code).toBe('TOP1-FREE')
    expect((await mine(db, R3)).some((x: Row) => x.sponsor_name === 'Massage B')).toBe(false)

    const quest = (await db.query<{ id: string }>(`select id from public.quests order by id`)).rows[0].id
    expect(await fails(save(db, ORG, { sponsor_name: 'Gel C', title: 'Gel miễn phí', target_type: 'QUEST', target_id: quest, code_mode: 'SHARED', shared_code: 'GEL' }))).toContain('FORBIDDEN')
    await save(db, ADM, { sponsor_name: 'Gel C', title: 'Gel miễn phí', target_type: 'QUEST', target_id: quest, code_mode: 'SHARED', shared_code: 'GEL' })
    await db.query(`insert into public.user_quest_progress (user_id, quest_id, period_start, progress, completed_at) values ($1, $2, current_date, 1, now())`, [R3, quest])
    const r3 = await mine(db, R3)
    const gel = r3.find((x: Row) => x.sponsor_name === 'Gel C')
    expect(gel?.code).toBe('GEL')
    await rpc(db, R3, `select public.mark_voucher_used($1, true) as r`, [gel!.campaign_id])
    expect((await mine(db, R3)).find((x: Row) => x.sponsor_name === 'Gel C')?.used_at).not.toBeNull()
    const all = await rpc<Row[]>(db, ADM, `select public.admin_list_voucher_campaigns() as r`)
    expect(all).toHaveLength(3)
  })
})
