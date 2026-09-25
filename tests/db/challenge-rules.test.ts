import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 005400: thể lệ bổ sung + danh sách thử thách bỏ thử thách đã hủy
const id = (n: number) => `00000000-0000-0000-0000-0000000054${String(n).padStart(2, '0')}`
const [ORG, R1, OUT] = [1, 2, 3].map(id)
const [CH_LIVE, CH_SOON] = ['00000000-0000-0000-0000-0000000054c1', '00000000-0000-0000-0000-0000000054c2']

async function seed(db: PGlite) {
  const users = [ORG, R1, OUT]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'r${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'R${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const setRules = (db: PGlite, uid: string, cid: string, p: object) => rpc<Row>(db, uid, `select public.set_challenge_rules($1, $2::jsonb) as r`, [cid, JSON.stringify(p)])
const list = async (db: PGlite, uid: string, tab: string) =>
  (await asUser<{ id: string }>(db, uid, '/rpc', `select id from public.list_challenges($1)`, [tab])).rows.map((x) => x.id)

describe('thể lệ thử thách + danh sách (005400)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.exec(`
      insert into public.challenges (id, title, start_date, end_date, target_value, target_km, min_km, status, created_by, target_audience)
        values ('${CH_LIVE}', 'Đang chạy', now() - interval '1 day', now() + interval '6 days', 50, 50, 1, 'ACTIVE', '${ORG}', 'PUBLIC'),
               ('${CH_SOON}', 'Sắp diễn ra', now() + interval '1 day', now() + interval '8 days', 50, 50, 1, 'ACTIVE', '${ORG}', 'PUBLIC');
      insert into public.challenge_participants (challenge_id, profile_id, status) values
        ('${CH_LIVE}', '${ORG}', 'JOINED'), ('${CH_LIVE}', '${R1}', 'JOINED'), ('${CH_SOON}', '${R1}', 'JOINED');
    `)
  }, 240_000)

  it('BTC lưu thể lệ (lọc khóa lạ, cắt độ dài, bỏ mục rỗng); người ngoài bị chặn; đã bắt đầu thì báo người tham gia', async () => {
    expect(await fails(setRules(db, OUT, CH_LIVE, { prizes: 'x' }))).toContain('FORBIDDEN')
    expect(await fails(setRules(db, ORG, CH_LIVE, { custom: Array.from({ length: 6 }, () => ({ title: 'Mục', body: 'a' })) }))).toContain('TOO_MANY_RULES')
    const r = await setRules(db, ORG, CH_LIVE, {
      prizes: '  Top 3 nhận cúp  ', penalties: '', hack: 'x', contact: 'A'.repeat(300),
      custom: [{ title: 'Lịch chạy nhóm', body: 'CN 5h' }, { title: '', body: 'bỏ' }],
    })
    expect(r).toEqual({ prizes: 'Top 3 nhận cúp', contact: 'A'.repeat(200), custom: [{ title: 'Lịch chạy nhóm', body: 'CN 5h' }] })
    const c = (await db.query<{ rules_info: Row; rules_updated_at: string | null }>(`select rules_info, rules_updated_at from public.challenges where id = $1`, [CH_LIVE])).rows[0]
    expect(c.rules_info).toEqual(r)
    expect(c.rules_updated_at).not.toBeNull()
    const notes = await db.query<{ user_id: string }>(`select user_id from public.notifications where kind = 'CHALLENGE_RULES'`)
    expect(notes.rows.map((x) => x.user_id)).toEqual([R1])            // báo người tham gia, không báo chính BTC
    // lưu lại y hệt → không báo thêm
    await setRules(db, ORG, CH_LIVE, r)
    expect((await db.query(`select 1 from public.notifications where kind = 'CHALLENGE_RULES'`)).rows).toHaveLength(1)
    // chưa bắt đầu → không báo
    await setRules(db, ORG, CH_SOON, { fees: '100.000đ nộp thủ quỹ' })
    expect((await db.query(`select 1 from public.notifications where kind = 'CHALLENGE_RULES'`)).rows).toHaveLength(1)
    // get_challenge trả thể lệ
    const d = await rpc<Row>(db, R1, `select public.get_challenge($1) as r`, [CH_SOON])
    expect(d.challenge.rules_info).toEqual({ fees: '100.000đ nộp thủ quỹ' })
  })

  it('hủy thử thách → biến mất khỏi Của tôi / Khám phá; người tham gia vẫn thấy trong Đã kết thúc', async () => {
    expect(await list(db, R1, 'MINE')).toContain(CH_SOON)
    expect(await list(db, OUT, 'DISCOVER')).toContain(CH_SOON)
    await rpc(db, ORG, `select public.cancel_challenge($1, 'Đổi lịch') as r`, [CH_SOON])
    expect(await list(db, R1, 'MINE')).not.toContain(CH_SOON)
    expect(await list(db, ORG, 'MINE')).not.toContain(CH_SOON)
    expect(await list(db, OUT, 'DISCOVER')).not.toContain(CH_SOON)
    expect(await list(db, R1, 'ENDED')).toContain(CH_SOON)
    expect(await list(db, R1, 'MINE')).toContain(CH_LIVE)
    expect(await fails(setRules(db, ORG, CH_SOON, { prizes: 'x' }))).toContain('CHALLENGE_CLOSED')
  })
})
