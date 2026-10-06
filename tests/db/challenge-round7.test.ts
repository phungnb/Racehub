import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 013300: chỉnh sửa lần 7 — thử thách
const id = (n: number) => `00000000-0000-0000-0000-0000001333${String(n).padStart(2, '0')}`
const [A, B, C, D] = [1, 2, 3, 4].map(id)     // A chủ nhiệm CLB / người tạo; B, C, D thành viên
const CLUB = '00000000-0000-0000-0000-0000001333c1'
type Row = Record<string, any>
const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

async function seed(db: PGlite) {
  const users = [A, B, C, D]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'r7${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'Runner ${i}', 0, 0, 1, now() - interval '90 days')`).join(', ')} on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB 133', '${A}', 'r7c133');
    insert into public.club_members (club_id, user_id, role, status) values
      ('${CLUB}', '${A}', 'OWNER', 'APPROVED'), ('${CLUB}', '${B}', 'MEMBER', 'APPROVED'),
      ('${CLUB}', '${C}', 'MEMBER', 'APPROVED'), ('${CLUB}', '${D}', 'MEMBER', 'APPROVED') on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r as T
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const balance = async (db: PGlite, acc: string) => Number((await db.query<{ b: string }>(`select private.balance($1) as b`, [acc])).rows[0].b)
const get = async (db: PGlite, cid: string) => (await db.query<Row>(`select * from public.challenges where id = $1`, [cid])).rows[0]
let seq = 0
const create = async (db: PGlite, p: Row, uid = A) =>
  (await rpc<{ challenge_id: string }>(db, uid, `select public.create_challenge_v2($1::jsonb, $2) as r`, [JSON.stringify(p), `r7-key-${++seq}`])).challenge_id
const upd = (db: PGlite, uid: string, cid: string, p: object) => rpc(db, uid, `select public.update_challenge($1, $2::jsonb) as r`, [cid, JSON.stringify(p)])
// Mỗi bài một khung giờ riêng (tránh luật trùng giờ)
let slot = 0
const run = (db: PGlite, uid: string, km: number, paceS: number) => {
  const startH = -(2 + slot++ * 3)
  return db.query(`
    insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
    values ($1, 'Chạy', 'DIRECT_GPS', now() + make_interval(hours => $4), now() + make_interval(hours => $4) + make_interval(secs => $3::int), $2::numeric, $2::numeric, $3::int, $5, 'APPROVED', 'READY')`,
    [uid, km * 1000, Math.round(km * paceS), startH, paceS])
}

describe('chỉnh sửa lần 7 — thử thách (013300)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    for (const acc of [A, CLUB]) {
      await db.query(`select private.ledger_post('TEST_SEED', 'seed-133-' || $1::text, 'seed', null,
        jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', 100000),
                          jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -100000)))`, [acc])
    }
  }, 300_000)

  it('danh sách: thử thách tự đăng ký mục tiêu hiện mục tiêu người xem đã chọn, không phải mốc thấp nhất', async () => {
    const cid = await create(db, { title: 'Thử thách tuần 41', format: 'SOLO_GOAL', objective: 'DISTANCE', target_value: 11,
      audience: 'CLUB_ONLY', club_id: CLUB, start_date: iso(24), end_date: iso(24 * 8), max_slots: 20 })
    await rpc(db, A, `select public.set_challenge_pledge($1, '{"options":[11,21,42]}'::jsonb) as r`, [cid])
    await rpc(db, B, `select public.join_challenge_pledge($1, 21) as r`, [cid])
    const mine = (await rpc<Row[]>(db, B, `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as r from public.list_challenges('CLUB', $1) t`, [CLUB]))
      .find((x) => x.id === cid)!
    expect(Number(mine.target_value)).toBe(21)
    // Chưa tham gia: mốc thấp nhất như cũ
    const other = (await rpc<Row[]>(db, C, `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as r from public.list_challenges('CLUB', $1) t`, [CLUB]))
      .find((x) => x.id === cid)!
    expect(Number(other.target_value)).toBe(11)

    // Đổi mốc trước giờ bắt đầu: mục tiêu 21 không còn → bỏ + nhắc chọn lại; mục tiêu chung = mốc thấp nhất mới
    await upd(db, A, cid, { pledge: { options: [15, 30], min_km: null, max_km: null, cap_pct: null } })
    expect((await db.query<Row>(`select pledge_km from public.challenge_participants where challenge_id = $1 and profile_id = $2`, [cid, B])).rows[0].pledge_km).toBeNull()
    expect(Number((await get(db, cid)).target_value)).toBe(15)
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'CHALLENGE_UPDATED' and title like 'Chọn lại mục tiêu%'`, [B])).rows).toHaveLength(1)
  })

  it('sửa trước giờ bắt đầu: thưởng chênh đi qua sổ cái + nhật ký quỹ; sức chứa ≥ số người đã tham gia; báo người tham gia', async () => {
    const cid = await create(db, { title: 'Tháng 11', format: 'RANKED', objective: 'DISTANCE', audience: 'CLUB_ONLY', club_id: CLUB,
      start_date: iso(48), end_date: iso(48 + 24 * 7), max_slots: 10, reward_xu: 1000, reward_source: 'CLUB', reward_split: 'TOP3' })
    for (const u of [B, C, D]) await rpc(db, u, `select public.join_challenge($1) as r`, [cid])
    const club0 = await balance(db, CLUB)

    expect(await fails(upd(db, B, cid, { reward_xu: 2000 }))).toContain('FORBIDDEN')
    expect(await fails(upd(db, A, cid, { max_slots: 2 }))).toContain('SLOTS_BELOW_JOINED')
    // Tăng thưởng 1000 → 3000: quỹ CLB trừ thêm 2000 (ký quỹ)
    await upd(db, A, cid, { reward_xu: 3000 })
    expect(await balance(db, CLUB)).toBe(club0 - 2000)
    // Giảm còn 500: hoàn 2500 về quỹ
    await upd(db, A, cid, { reward_xu: 500 })
    expect(await balance(db, CLUB)).toBe(club0 + 500)
    const log = (await db.query<Row>(`select amount, kind from public.club_treasury_log where club_id = $1 and note like '%Tháng 11%' order by created_at`, [CLUB])).rows
    expect(log.map((x) => [Number(x.amount), x.kind])).toEqual(expect.arrayContaining([[-2000, 'REWARD'], [2500, 'CONTRIBUTE']]))
    expect((await get(db, cid))).toMatchObject({ reward_source: 'CLUB' })
    // Huỷ: hoàn đúng phần đang ký quỹ (500)
    await rpc(db, A, `select public.cancel_challenge($1, 'thử') as r`, [cid])
    expect(await balance(db, CLUB)).toBe(club0 + 1000)
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'CHALLENGE_UPDATED' and link = $2`, [C, `/challenges/${cid}`])).rows.length).toBeGreaterThanOrEqual(2)
  })

  it('sửa trước giờ bắt đầu: thời lượng, cách tính điểm, số người (thu phí chênh), đối tượng, nhịp tim; sau giờ bắt đầu giữ luật cũ', async () => {
    const cid = await create(db, { title: 'Cá nhân', format: 'SOLO_GOAL', objective: 'DISTANCE', target_value: 50, audience: 'PUBLIC',
      start_date: iso(24), end_date: iso(24 * 4), max_slots: 5 })
    const fee5 = (await get(db, cid)).fee_charged
    const wallet0 = await balance(db, A)
    await upd(db, A, cid, { end_date: iso(24 * 30), objective: 'STREAK_DAYS', target_value: 10, min_km: 3, require_hr: true,
      audience: 'INVITE_ONLY', max_slots: 200 })
    const c = await get(db, cid)
    expect(c).toMatchObject({ objective: 'STREAK_DAYS', game_mode: 'STREAK', require_hr: true, target_audience: 'INVITE_ONLY', max_slots: 200 })
    expect((await db.query(`select 1 from public.challenge_invites where challenge_id = $1`, [cid])).rows).toHaveLength(1)
    const fee200 = Number((await db.query<{ f: number }>(`select private.challenge_creation_fee(false, 200, now(), now()) as f`)).rows[0].f)
    expect(await balance(db, A)).toBe(wallet0 - Math.max(0, fee200 - Number(fee5)))
    expect(Number(c.fee_charged)).toBe(Math.max(Number(fee5), fee200))
    // Thử thách cá nhân không treo thưởng; chuyển sang chinh phục phải kèm hạng mục
    expect(await fails(upd(db, A, cid, { reward_xu: 100 }))).toContain('REWARD_NOT_ALLOWED')
    expect(await fails(upd(db, A, cid, { objective: 'BEST_TIME' }))).toContain('INVALID_CONQUEST')

    await db.query(`update public.challenges set start_date = now() - interval '1 minute' where id = $1`, [cid])
    expect(await fails(upd(db, A, cid, { title: 'Muộn rồi' }))).toContain('CHALLENGE_STARTED')
  })

  it('hạng mục chinh phục: trước giờ bắt đầu đổi được dù đã có người đăng ký; giữ đăng ký hạng mục không đổi cự ly', async () => {
    const cid = await create(db, { title: 'Sub', format: 'SOLO_GOAL', objective: 'DISTANCE', target_value: 1, audience: 'PUBLIC',
      start_date: iso(24), end_date: iso(24 * 5), max_slots: 20 })
    const b0 = await rpc(db, A, `select public.set_challenge_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify({
      objective: 'BEST_TIME', mode: 'FIXED', categories: [{ label: '5K', distance_km: 5, target_s: 1800 }, { label: '10K', distance_km: 10, target_s: 3600 }] })])
    await rpc(db, B, `select public.join_challenge($1) as r`, [cid])
    await rpc(db, B, `select public.set_my_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify(b0.categories.map((x: Row) => ({ category_id: x.id })))])
    await upd(db, A, cid, { conquest: { objective: 'BEST_TIME', mode: 'FIXED',
      categories: [{ label: '5K', distance_km: 5, target_s: 1700 }, { label: 'Half', distance_km: 21.0975, target_s: 8000 }] } })
    const b1 = await rpc(db, B, `select public.challenge_conquest_board($1) as r`, [cid])
    expect(b1.categories.map((x: Row) => [x.label, x.target_s])).toEqual([['5K', 1700], ['Half', 8000]])
    expect(b1.mine.map((x: Row) => x.category_id)).toEqual([b0.categories[0].id])
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and title like 'Chọn lại hạng mục%'`, [B])).rows).toHaveLength(0)
  })

  it('chinh phục: đã đăng ký mà có kết quả cho cự ly thì không thêm / đổi / bỏ đăng ký cự ly đó', async () => {
    const cid = await create(db, { title: 'Pace tự đặt', format: 'SOLO_GOAL', objective: 'DISTANCE', target_value: 1, audience: 'PUBLIC',
      start_date: iso(-48), end_date: iso(24 * 5), max_slots: 20 })
    const b = await rpc(db, A, `select public.set_challenge_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify({
      objective: 'BEST_PACE', mode: 'SELF', categories: [{ label: '5K', distance_km: 5 }, { label: '21K', distance_km: 21.0975 }] })])
    const [k5, k21] = b.categories.map((x: Row) => x.id)
    await run(db, C, 6, 330)                       // C đã chạy 6 km trước khi tham gia (tham gia trễ vẫn tính)
    await rpc(db, C, `select public.join_challenge($1) as r`, [cid])
    const board = await rpc(db, C, `select public.challenge_conquest_board($1) as r`, [cid])
    expect(board.my_results).toEqual([k5])
    // Lần đăng ký đầu (tham gia trễ): như cũ, chọn 21K
    await rpc(db, C, `select public.set_my_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify([{ category_id: k21, target_s: 360 }])])
    // Sửa đăng ký: thêm 5K đã có kết quả → chặn
    expect(await fails(rpc(db, C, `select public.set_my_conquest($1, $2::jsonb) as r`, [cid,
      JSON.stringify([{ category_id: k21, target_s: 360 }, { category_id: k5, target_s: 340 }])]))).toContain('CONQUEST_RESULT_LOCKED')
    // Đã đăng ký 5K từ trước rồi mới có kết quả → không đổi mục tiêu, không bỏ được
    await rpc(db, B, `select public.join_challenge($1) as r`, [cid])
    await rpc(db, B, `select public.set_my_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify([{ category_id: k5, target_s: 300 }, { category_id: k21, target_s: 360 }])])
    await run(db, B, 5.5, 320)
    expect(await fails(rpc(db, B, `select public.set_my_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify([{ category_id: k5, target_s: 330 }, { category_id: k21, target_s: 360 }])])))
      .toContain('CONQUEST_RESULT_LOCKED')
    expect(await fails(rpc(db, B, `select public.set_my_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify([{ category_id: k21, target_s: 360 }])])))
      .toContain('CONQUEST_RESULT_LOCKED')
  })

  it('lặp hằng tuần: "Thử thách tuần 41" → kỳ sau "Thử thách tuần 42", không thêm "Kỳ 2"', async () => {
    const t = async (title: string, rec: string, start: string) =>
      (await db.query<{ t: string }>(`select private.recur_title($1, $2, 1, $3::timestamptz) as t`, [title, rec, start])).rows[0].t
    expect(await t('Thử thách tuần 41', 'WEEKLY', '2026-10-05T00:00:00+07:00')).toBe('Thử thách tuần 41')
    expect(await t('Thử thách tuần 41 · Kỳ 2', 'WEEKLY', '2026-10-12T00:00:00+07:00')).toBe('Thử thách tuần 42')
    expect(await t('TUẦN 52 - lần 3', 'WEEKLY', '2026-12-28T00:00:00+07:00')).toBe('TUẦN 53')
    expect(await t('Chạy tháng', 'MONTHLY', '2026-11-01T00:00:00+07:00')).toBe('Chạy tháng · Kỳ 2')

    const first = await create(db, { title: 'Thử thách tuần 41', format: 'RANKED', objective: 'DISTANCE', audience: 'CLUB_ONLY', club_id: CLUB,
      max_slots: 5, start_date: iso(-24 * 6), end_date: iso(20) })
    await rpc(db, A, `select public.set_challenge_recurrence($1, 'WEEKLY') as r`, [first])
    const next = (await db.query<{ id: string }>(`select private.spawn_next_occurrence($1) as id`, [first])).rows[0].id
    const n = await get(db, next)
    const week = (await db.query<{ w: number }>(`select extract(week from ($1::timestamptz at time zone 'Asia/Ho_Chi_Minh'))::int as w`, [n.start_date])).rows[0].w
    expect(n.title).toBe(`Thử thách tuần ${week}`)
  })

  it('vinh danh theo mục tiêu BTC đặt (GOAL<mét>) và theo hạng mục chinh phục (CAT<n>)', async () => {
    const cid = await create(db, { title: 'Mục tiêu', format: 'SOLO_GOAL', objective: 'DISTANCE', target_value: 5, audience: 'PUBLIC',
      start_date: iso(-24 * 5), end_date: iso(24), max_slots: 20 })
    await rpc(db, A, `select public.set_challenge_pledge($1, '{"options":[5,21]}'::jsonb) as r`, [cid])
    // Mục tiêu đặt trước khi chạy (đặt thẳng để không vướng luật "đã chạy đủ")
    for (const [u, km] of [[B, 21], [C, 5], [D, 21]] as const) {
      await db.query(`insert into public.challenge_participants (challenge_id, profile_id, status, pledge_km) values ($1, $2, 'JOINED', $3)`, [cid, u, km])
    }
    await run(db, B, 22, 360)
    await run(db, C, 6, 360)
    await run(db, D, 10, 360)
    const rows = (await db.query<Row>(`select h.* from public.challenges c, private.honor_compute(c, '[{"key":"GOAL21000","count":3},{"key":"GOAL5000","count":3}]'::jsonb) h
      where c.id = $1 order by h.category, h.rank`, [cid])).rows
    expect(rows.map((r) => [r.category, r.user_id])).toEqual([['GOAL21000', B], ['GOAL5000', C]])
    expect((await db.query<{ r: Row[] }>(`select private.honor_categories('[{"key":"GOAL21000","title":"Hoàn thành 21 km"},{"key":"CAT2"}]'::jsonb) as r`)).rows[0].r)
      .toMatchObject([{ key: 'GOAL21000', title: 'Hoàn thành 21 km' }, { key: 'CAT2' }])
    expect(await fails(db.query(`select private.honor_categories('[{"key":"CAT9"}]'::jsonb)`))).toContain('INVALID_HONOR_CATEGORIES')
  })
})
