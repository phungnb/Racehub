import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 010500: ai thích / ai tặng quà trên bài đăng, bảng tin cộng đồng, xóa thông báo
const [OWNER, A, B, OUT] = [1, 2, 3, 4].map((n) => `00000000-0000-0000-0000-0000001050${String(n).padStart(2, '0')}`)
type Row = Record<string, any>

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o105@x.vn'), ('${A}', 'a105@x.vn'), ('${B}', 'b105@x.vn'), ('${OUT}', 'x105@x.vn');
    insert into public.profiles (id, display_name) values ('${OWNER}', 'Chủ nhiệm'), ('${A}', 'An'), ('${B}', 'Bình'), ('${OUT}', 'Ngoài') on conflict do nothing;
  `)
}
const rpc = async <T = Row,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('thích + quà tặng + bảng tin cộng đồng (010500)', () => {
  let db: PGlite
  let club: string, club2: string, post: string
  const engagement = (uid: string) => rpc<Row>(db, uid, `select public.post_engagement($1) as r`, [post])

  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    const c = await rpc<{ id: string; invite_code: string }>(db, OWNER, `select public.create_club('Hồ Tây 105', 'Chạy sáng') as r`)
    const c2 = await rpc<{ id: string; invite_code: string }>(db, OWNER, `select public.create_club('Gò Vấp 105', 'Chạy tối') as r`)
    club = c.id; club2 = c2.id
    await db.query(`update public.clubs set join_policy = 'OPEN' where id = any($1::uuid[])`, [[club, club2]])
    for (const u of [A, B]) await asUser(db, u, '/rpc', `select public.join_club_by_code($1)`, [c.invite_code])
    await asUser(db, A, '/rpc', `select public.join_club_by_code($1)`, [c2.invite_code])
    post = (await rpc<{ id: string }>(db, OWNER, `select to_jsonb(public.create_club_post($1, 'Chạy xong 10 km!')) as r`, [club])).id
    await db.query(`select private.ledger_post('TEST_SEED', 'seed-105', 'seed', null,
      jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', 500),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -500)))`, [A])
  }, 300_000)

  it('ai cũng thấy số lượt thích, số lượt quà, ai thích, ai tặng gì; lời nhắn chỉ người tặng / người nhận đọc', async () => {
    await rpc(db, A, `select public.toggle_post_reaction($1) as r`, [post])
    await rpc(db, B, `select public.toggle_post_reaction($1) as r`, [post])
    await rpc(db, A, `select public.send_gift($1, 'coffee', 5, 'Đỉnh quá anh', $2, null, 'gift-105-a') as r`, [OWNER, post])
    await rpc(db, A, `select public.send_gift($1, 'clap', 1, null, $2, null, 'gift-105-b') as r`, [OWNER, post])

    const seenByB = await engagement(B)
    expect(seenByB).toMatchObject({ like_count: 2, gift_count: 6, gift_senders: 1 })
    expect(seenByB.likes.map((l: Row) => l.display_name).sort()).toEqual(['An', 'Bình'])
    expect(seenByB.gifts).toHaveLength(2)
    expect(seenByB.gifts.find((g: Row) => g.qty === 5)).toMatchObject({ display_name: 'An', emoji: '☕', message: null })
    expect(seenByB.gift_summary[0]).toMatchObject({ qty: 5 })
    // Người nhận (chủ bài) đọc được lời nhắn
    expect((await engagement(OWNER)).gifts.find((g: Row) => g.qty === 5).message).toBe('Đỉnh quá anh')
    // Cột đếm trên bài để bảng tin hiện ngay
    expect(Number((await db.query<{ n: number }>(`select gift_count n from public.club_posts where id = $1`, [post])).rows[0].n)).toBe(6)
    expect(await fails(engagement(OUT))).toContain('NOT_A_MEMBER')
  })

  it('thông báo đổi "cổ vũ" → "thích"', async () => {
    const t = (await db.query<{ title: string }>(`select title from public.notifications where user_id = $1 and kind = 'POST_CHEER' order by created_at`, [OWNER])).rows
    expect(t[0].title).toContain('đã thích bài đăng của bạn')
  })

  it('bảng tin cộng đồng: bài từ mọi CLB mình tham gia, một bài chạy ở nhiều CLB chỉ hiện một lần', async () => {
    await rpc(db, OWNER, `select to_jsonb(public.create_club_post($1, 'Tối nay chạy nhé')) as r`, [club2])
    const now = new Date(Date.now() - 3600_000).toISOString()
    const act = (await db.query<{ id: string }>(`
      insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
      values ($1, 'Chạy sáng', 'DIRECT_GPS', $2::timestamptz, $2::timestamptz + interval '1 minute', 5000, 5000, 1800, 360, 'APPROVED', 'READY') returning id`, [A, now])).rows[0].id
    for (const c of [club, club2]) {
      await db.query(`insert into public.club_posts (club_id, author_id, kind, body, activity_id, meta) values ($1, $2, 'AUTO_RUN', 'Chạy sáng', $3, '{"distance_m":5000}')
                      on conflict do nothing`, [c, A, act])
    }
    const feedA = await rpc<Row[]>(db, A, `select public.community_feed(null, 20) as r`)
    expect(feedA.filter((p) => p.activity_id === act)).toHaveLength(1)
    expect(new Set(feedA.map((p) => p.club.id))).toEqual(new Set([club, club2]))
    expect(feedA.find((p) => p.id === post)).toMatchObject({ reacted: true, gift_count: 6, reaction_count: 2 })
    // B chỉ ở CLB 1: không thấy bài CLB 2
    const feedB = await rpc<Row[]>(db, B, `select public.community_feed(null, 20) as r`)
    expect(feedB.every((p) => p.club.id === club)).toBe(true)
    // Phân trang
    const first = await rpc<Row[]>(db, A, `select public.community_feed(null, 1) as r`)
    const next = await rpc<Row[]>(db, A, `select public.community_feed($1, 20) as r`, [first[0].created_at])
    expect(next.some((p) => p.id === first[0].id)).toBe(false)
    expect(await rpc<Row[]>(db, OUT, `select public.community_feed(null, 20) as r`)).toEqual([])
  })

  it('xóa thông báo: từng cái hoặc hết thông báo đã đọc; không xóa được của người khác', async () => {
    const ids = (await db.query<{ id: string }>(`select id from public.notifications where user_id = $1 order by created_at`, [OWNER])).rows.map((r) => r.id)
    expect(ids.length).toBeGreaterThan(1)
    expect(await rpc(db, A, `select public.delete_notifications($1::uuid[]) as r`, [[ids[0]]])).toBe(0)
    expect(await rpc(db, OWNER, `select public.delete_notifications($1::uuid[]) as r`, [[ids[0]]])).toBe(1)
    await rpc(db, OWNER, `select public.mark_notifications_read(array[$1]::uuid[]) as r`, [ids[1]])
    expect(await rpc(db, OWNER, `select public.delete_notifications(null, true) as r`)).toBe(1)
    expect(await fails(rpc(db, OWNER, `select public.delete_notifications(null, false) as r`))).toContain('NOTHING_SELECTED')
  })
})
