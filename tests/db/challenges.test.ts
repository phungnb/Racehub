import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 000600: engine thử thách (cá nhân, 1-1, đội, cộng đồng, CLB), tiến độ, tất toán
const A = '00000000-0000-0000-0000-0000000000f1'   // người tạo
const B = '00000000-0000-0000-0000-0000000000f2'
const C = '00000000-0000-0000-0000-0000000000f3'
const D = '00000000-0000-0000-0000-0000000000f4'
const OUT = '00000000-0000-0000-0000-0000000000f5'  // người ngoài / người không có Xu

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${A}', 'a@x.vn'), ('${B}', 'b@x.vn'), ('${C}', 'c@x.vn'), ('${D}', 'd@x.vn'), ('${OUT}', 'o@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${A}', 'An', 0, 0, 1, now()), ('${B}', 'Bình', 0, 0, 1, now()), ('${C}', 'Chi', 0, 0, 1, now()),
      ('${D}', 'Dũng', 0, 0, 1, now()), ('${OUT}', 'Ngoài', 0, 0, 1, now());
  `)
}

type Row = Record<string, unknown>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) =>
  (await asUser<T>(db, uid, '/rpc', sql, params)).rows
const fails = async (db: PGlite, uid: string | null, sql: string, params: unknown[] = []) => {
  try { await asUser(db, uid, '/rpc', sql, params) } catch (e) { return (e as Error).message }
  return 'OK'
}
const iso = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3600_000).toISOString()
let seq = 0
const create = async (db: PGlite, uid: string, p: Record<string, unknown>) =>
  (await rpc<{ r: { challenge_id: string; fee: number; invite_code: string | null } }>(db, uid,
    `select public.create_challenge_v2($1::jsonb, $2) as r`, [JSON.stringify(p), `test-key-${++seq}`]))[0].r
const run = async (db: PGlite, uid: string, km: number, hoursAgo: number, paceS = 360) => {
  const r = await db.query<{ id: string }>(`
    insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
    values ($1, 'Chạy', 'DIRECT_GPS', now() - make_interval(mins => $2::int), now() - make_interval(mins => $2::int) + interval '30 minutes',
            $3::numeric, $3::numeric, $4::int, $5::int, 'APPROVED', 'READY') returning id`,
    [uid, Math.round(hoursAgo * 60), km * 1000, Math.round(km * paceS), paceS])
  return r.rows[0].id
}
const participant = async (db: PGlite, cid: string, uid: string) =>
  (await db.query<{ current_progress: string; status: string; run_count: number; reward_xu: string; final_rank: number | null }>(
    `select current_progress, status, run_count, reward_xu, final_rank from public.challenge_participants where challenge_id = $1 and profile_id = $2`,
    [cid, uid])).rows[0]
const xu = async (db: PGlite, id: string) => Number((await db.query<{ b: string }>(`select private.balance($1) as b`, [id])).rows[0].b)
const shiftToPast = (db: PGlite, cid: string, startHoursAgo: number, endHoursAgo?: number) =>
  db.query(`update public.challenges set start_date = now() - make_interval(hours => $2::int),
            end_date = coalesce(now() - make_interval(hours => $3::int), end_date) where id = $1`, [cid, startHoursAgo, endHoursAgo ?? null])

describe('Engine thử thách (000600)', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    // Nạp Xu thử nghiệm cho A và B
    for (const [u, amt] of [[A, 1000], [B, 200]] as const) {
      await db.query(`select private.ledger_post('TEST_SEED', 'seed:' || $1, 'seed', null,
        jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', $2::numeric),
                          jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -$2::numeric)))`, [u, amt])
    }
  }, 240_000)

  it('tạo thử thách xếp hạng có treo thưởng: trừ phí + ký quỹ, người tạo tự vào; chống gửi trùng', async () => {
    const before = await xu(db, A)
    const key = 'same-key-123'
    const p = { title: 'Ai chạy nhiều nhất tuần', format: 'RANKED', objective: 'DISTANCE', start_date: iso(-1), end_date: iso(24 * 7),
      max_slots: 20, reward_xu: 100, reward_source: 'CREATOR', reward_split: 'WINNER', min_km: 1 }
    const r1 = (await rpc<{ r: { challenge_id: string; fee: number } }>(db, A, `select public.create_challenge_v2($1::jsonb, $2) as r`, [JSON.stringify(p), key]))[0].r
    const r2 = (await rpc<{ r: { challenge_id: string; duplicate: boolean } }>(db, A, `select public.create_challenge_v2($1::jsonb, $2) as r`, [JSON.stringify(p), key]))[0].r
    expect(r2).toMatchObject({ challenge_id: r1.challenge_id, duplicate: true })
    expect(r1.fee).toBeGreaterThan(0)
    expect(await xu(db, A)).toBe(before - r1.fee - 100)
    expect(await participant(db, r1.challenge_id, A)).toMatchObject({ status: 'JOINED' })
  })

  it('không đủ Xu thì không tạo được; dữ liệu sai bị từ chối', async () => {
    expect(await fails(db, OUT, `select public.create_challenge_v2($1::jsonb, 'k-out-1234')`,
      [JSON.stringify({ title: 'Thử', format: 'RANKED', start_date: iso(0), end_date: iso(48), reward_xu: 50, reward_source: 'CREATOR' })]))
      .toContain('INSUFFICIENT_BALANCE')
    expect(await fails(db, A, `select public.create_challenge_v2($1::jsonb, 'k-bad-1234')`,
      [JSON.stringify({ title: 'Mục tiêu', format: 'SOLO_GOAL', start_date: iso(0), end_date: iso(48) })])).toContain('TARGET_REQUIRED')
    expect(await fails(db, A, `select public.create_challenge_v2($1::jsonb, 'k-bad-5678')`,
      [JSON.stringify({ title: 'Đội', format: 'TEAM', game_mode: 'TEAM_SUM', team_names: ['Một'], start_date: iso(1), end_date: iso(48) })])).toContain('INVALID_TEAMS')
  })

  it('không ghi thẳng vào bảng thử thách; người ngoài không thấy thử thách mời riêng', async () => {
    expect(await fails(db, A, `insert into public.challenge_participants (challenge_id, profile_id) select id, $1 from public.challenges limit 1`, [A]))
      .toMatch(/permission denied/)
    const r = await create(db, A, { title: 'Kèo riêng', format: 'RANKED', audience: 'INVITE_ONLY', start_date: iso(-1), end_date: iso(48) })
    expect(r.invite_code).toMatch(/^[a-z0-9]{8}$/)
    expect((await asUser(db, OUT, '/challenges', `select id from public.challenges where id = $1`, [r.challenge_id])).rows).toHaveLength(0)
    expect(await fails(db, OUT, `select public.get_challenge($1)`, [r.challenge_id])).toContain('CHALLENGE_NOT_FOUND')
    expect(await fails(db, OUT, `select public.join_challenge($1)`, [r.challenge_id])).toContain('INVALID_INVITE')
    // Có mã mời → xem được và vào được
    const g = (await rpc<{ g: { invite_code: string } }>(db, OUT, `select public.get_challenge($1, $2) as g`, [r.challenge_id, r.invite_code]))[0].g
    expect(g.invite_code).toBe(r.invite_code)
    await rpc(db, OUT, `select public.join_challenge($1, $2)`, [r.challenge_id, r.invite_code])
    expect(await fails(db, OUT, `select public.join_challenge($1, $2)`, [r.challenge_id, r.invite_code])).toContain('ALREADY_JOINED')
  })

  it('tiến độ: chỉ tính bài hợp lệ trong thời gian thử thách; luật cự ly, pace, trần km/ngày; bài bị xóa thì trừ lại', async () => {
    const r = await create(db, A, { title: 'Tích lũy có trần', format: 'RANKED', objective: 'DISTANCE', start_date: iso(-48), end_date: iso(48),
      min_km: 2, min_pace: 4, max_pace: 10, daily_cap_km: 15 })
    await shiftToPast(db, r.challenge_id, 48)
    await rpc(db, B, `select public.join_challenge($1)`, [r.challenge_id])
    await run(db, B, 10, 3)                  // tính 10
    await run(db, B, 1.5, 4)                 // dưới 2 km → không tính
    await run(db, B, 5, 5, 150)              // pace 2:30 → không tính
    await run(db, B, 8, 6)                   // cùng ngày: trần 15 → chỉ tính 5 (có thể khác ngày nếu chạy gần nửa đêm)
    await run(db, B, 7, 100)                 // trước khi thử thách bắt đầu → không tính
    const p = await participant(db, r.challenge_id, B)
    expect(Number(p.current_progress)).toBeGreaterThanOrEqual(15)
    expect(Number(p.current_progress)).toBeLessThanOrEqual(18)
    const del = await run(db, B, 3, 2)
    const before = Number((await participant(db, r.challenge_id, B)).current_progress)
    await db.query(`update public.activities set status = 'DELETED', validation_status = 'REJECTED' where id = $1`, [del])
    expect(Number((await participant(db, r.challenge_id, B)).current_progress)).toBeLessThan(before + 0.001)
  })

  it('vào muộn vẫn được tính các bài đã chạy trong thời gian thử thách', async () => {
    const r = await create(db, A, { title: 'Vào muộn', format: 'RANKED', start_date: iso(-10), end_date: iso(48) })
    await shiftToPast(db, r.challenge_id, 10)
    await run(db, C, 6, 2)
    await rpc(db, C, `select public.join_challenge($1)`, [r.challenge_id])
    expect(Number((await participant(db, r.challenge_id, C)).current_progress)).toBe(6)
  })

  it('đội: 4 chế độ tính điểm; khóa danh sách khi đã bắt đầu; không rời được', async () => {
    const r = await create(db, A, { title: 'Chim Ưng vs Cá Mập', format: 'TEAM', game_mode: 'TEAM_SUM', team_names: ['Chim Ưng', 'Cá Mập'],
      start_date: iso(2), end_date: iso(72), team_size: 3 })
    const teams = (await db.query<{ id: string }>(`select id from public.challenge_teams where challenge_id = $1 order by position`, [r.challenge_id])).rows
    await rpc(db, A, `select public.join_challenge($1, null, $2)`, [r.challenge_id, teams[0].id])
    await rpc(db, B, `select public.join_challenge($1, null, $2)`, [r.challenge_id, teams[0].id])
    await rpc(db, C, `select public.join_challenge($1, null, $2)`, [r.challenge_id, teams[1].id])
    await rpc(db, D, `select public.join_challenge($1)`, [r.challenge_id])      // tự vào đội ít người hơn
    expect((await db.query(`select team_id from public.challenge_participants where challenge_id = $1 and profile_id = $2`, [r.challenge_id, D])).rows[0])
      .toMatchObject({ team_id: teams[1].id })

    await shiftToPast(db, r.challenge_id, 5)
    expect(await fails(db, OUT, `select public.join_challenge($1)`, [r.challenge_id])).toContain('TEAM_ROSTER_LOCKED')
    expect(await fails(db, B, `select public.leave_challenge($1)`, [r.challenge_id])).toContain('CANNOT_LEAVE_STARTED')
    // Chim Ưng: A 20, B 0 · Cá Mập: C 8, D 8
    await run(db, A, 20, 1)
    await run(db, C, 8, 1)
    await run(db, D, 8, 1)
    const standings = async (mode: string) => {
      await db.query(`update public.challenges set game_mode = $2 where id = $1`, [r.challenge_id, mode])
      return (await rpc<{ name: string; score: string }>(db, A, `select name, score from public.challenge_team_standings($1) order by name`, [r.challenge_id]))
        .map((t) => [t.name, Number(t.score)])
    }
    expect(await standings('TEAM_SUM')).toEqual([['Chim Ưng', 20], ['Cá Mập', 16]])
    expect(await standings('TEAM_AVG')).toEqual([['Chim Ưng', 10], ['Cá Mập', 8]])
    expect(await standings('LAST_MEMBER')).toEqual([['Chim Ưng', 0], ['Cá Mập', 8]])       // chốt đoàn: người yếu nhất
    expect(await standings('TEAM_GAP')).toEqual([['Chim Ưng', 0], ['Cá Mập', 8]])          // 10 − ½×20 = 0 · 8 − 0 = 8
  })

  it('tất toán 1-1: người thắng nhận toàn bộ tiền treo, +XP; chạy lại không trả 2 lần', async () => {
    const r = await create(db, A, { title: 'Solo 5 ngày', format: 'DUEL', start_date: iso(-30), end_date: iso(48), reward_xu: 60, reward_source: 'CREATOR' })
    await shiftToPast(db, r.challenge_id, 30)
    await rpc(db, D, `select public.join_challenge($1, $2)`, [r.challenge_id, r.invite_code])
    expect(await fails(db, C, `select public.join_challenge($1, $2)`, [r.challenge_id, r.invite_code])).toContain('CHALLENGE_FULL')
    await run(db, D, 12, 10)
    await run(db, A, 5, 10)
    await shiftToPast(db, r.challenge_id, 30, 3)
    const dBefore = await xu(db, D)
    const xpBefore = Number((await db.query<{ xp: number }>(`select xp from public.profiles where id = $1`, [D])).rows[0].xp)
    expect((await rpc<{ ok: boolean }>(db, D, `select public.settle_challenge_if_due($1) as ok`, [r.challenge_id]))[0].ok).toBe(true)
    expect((await rpc<{ ok: boolean }>(db, D, `select public.settle_challenge_if_due($1) as ok`, [r.challenge_id]))[0].ok).toBe(false)
    expect(await xu(db, D)).toBe(dBefore + 60)
    expect(Number((await db.query<{ xp: number }>(`select xp from public.profiles where id = $1`, [D])).rows[0].xp)).toBe(xpBefore + 100)
    expect(await participant(db, r.challenge_id, D)).toMatchObject({ final_rank: 1 })
    expect((await db.query(`select status from public.challenges where id = $1`, [r.challenge_id])).rows[0]).toMatchObject({ status: 'FINISHED' })
    expect((await asUser(db, D, '/notifications', `select 1 from public.notifications where kind = 'CHALLENGE_RESULT'`)).rows.length).toBeGreaterThan(0)
  })

  it('chưa hết 2 giờ sau kết thúc thì chưa tất toán (chờ bài đồng bộ muộn)', async () => {
    const r = await create(db, A, { title: 'Vừa kết thúc', format: 'RANKED', start_date: iso(-30), end_date: iso(48) })
    await shiftToPast(db, r.challenge_id, 30, 1)
    expect((await rpc<{ ok: boolean }>(db, A, `select public.settle_challenge_if_due($1) as ok`, [r.challenge_id]))[0].ok).toBe(false)
  })

  it('cộng đồng: đạt mốc chung thì chia đều cho người có đóng góp; không đạt thì hoàn tiền người treo', async () => {
    const ok = await create(db, A, { title: 'Cùng chạy 20 km', format: 'COLLECTIVE', target_value: 20, start_date: iso(-30), end_date: iso(48),
      reward_xu: 40, reward_source: 'CREATOR' })
    const fail = await create(db, A, { title: 'Cùng chạy 999 km', format: 'COLLECTIVE', target_value: 999, start_date: iso(-30), end_date: iso(48),
      reward_xu: 30, reward_source: 'CREATOR' })
    for (const r of [ok, fail]) {
      await shiftToPast(db, r.challenge_id, 30)
      await rpc(db, B, `select public.join_challenge($1)`, [r.challenge_id])
      await rpc(db, C, `select public.join_challenge($1)`, [r.challenge_id])
    }
    await run(db, B, 12, 20)
    await run(db, C, 9, 20)
    for (const r of [ok, fail]) await shiftToPast(db, r.challenge_id, 30, 3)
    const [aB, bB, cB] = [await xu(db, A), await xu(db, B), await xu(db, C)]
    expect(await rpc(db, A, `select public.settle_due_challenges()`).catch((e) => String(e))).toMatch(/permission denied/)
    await db.exec('set role service_role')
    await db.query(`select public.settle_due_challenges()`)
    await db.exec('reset role')
    expect(await xu(db, B)).toBe(bB + 20)
    expect(await xu(db, C)).toBe(cB + 20)
    expect(await xu(db, A)).toBe(aB + 30)        // hoàn tiền thử thách không đạt mốc
  })

  it('CLB: chỉ ban quản trị tạo, thưởng trích quỹ CLB, đăng bảng tin + báo thành viên; người ngoài không vào được', async () => {
    const club = (await rpc<{ c: { id: string; invite_code: string } }>(db, A, `select public.create_club('Hồ Gươm Runners') as c`))[0].c
    await db.query(`update public.clubs set join_policy = 'OPEN' where id = $1`, [club.id])
    await rpc(db, B, `select public.join_club($1)`, [club.id])
    await rpc(db, A, `select public.contribute_treasury($1, 150)`, [club.id])
    expect(await fails(db, B, `select public.create_challenge_v2($1::jsonb, 'k-club-no-staff')`,
      [JSON.stringify({ title: 'Nội bộ', format: 'RANKED', audience: 'CLUB_ONLY', club_id: club.id, start_date: iso(0), end_date: iso(48) })]))
      .toContain('FORBIDDEN')
    const r = await create(db, A, { title: 'Thử thách tháng CLB', format: 'RANKED', audience: 'CLUB_ONLY', club_id: club.id,
      start_date: iso(-1), end_date: iso(48), reward_xu: 100, reward_source: 'CLUB', reward_split: 'TOP3' })
    expect(r.fee).toBe(0)
    expect(await xu(db, club.id)).toBe(50)
    expect((await db.query(`select kind from public.club_posts where club_id = $1 and kind = 'CHALLENGE'`, [club.id])).rows).toHaveLength(1)
    expect((await asUser(db, B, '/notifications', `select 1 from public.notifications where kind = 'CHALLENGE_NEW'`)).rows).toHaveLength(1)
    expect(await fails(db, OUT, `select public.join_challenge($1)`, [r.challenge_id])).toContain('CLUB_MEMBERS_ONLY')
    await rpc(db, B, `select public.join_challenge($1)`, [r.challenge_id])
    const list = await rpc<{ id: string }>(db, B, `select id from public.list_challenges('CLUB', $1)`, [club.id])
    expect(list.map((x) => x.id)).toContain(r.challenge_id)
  })

  it('hủy trước khi bắt đầu: hoàn tiền treo thưởng, báo người tham gia; người khác không hủy được', async () => {
    const r = await create(db, A, { title: 'Sẽ hủy', format: 'RANKED', start_date: iso(5), end_date: iso(48), reward_xu: 25, reward_source: 'CREATOR' })
    await rpc(db, B, `select public.join_challenge($1)`, [r.challenge_id])
    expect(await fails(db, B, `select public.cancel_challenge($1)`, [r.challenge_id])).toContain('FORBIDDEN')
    const before = await xu(db, A)
    await rpc(db, A, `select public.cancel_challenge($1, 'Trời mưa')`, [r.challenge_id])
    expect(await xu(db, A)).toBe(before + 25)
    expect((await db.query(`select status from public.challenges where id = $1`, [r.challenge_id])).rows[0]).toMatchObject({ status: 'CANCELLED' })
  })

  it('danh sách: Khám phá không hiện thử thách mình đã vào; Của tôi có tiến độ và hạng', async () => {
    const r = await create(db, A, { title: 'Khám phá tôi đi', format: 'RANKED', start_date: iso(-1), end_date: iso(48) })
    const discoverB = await rpc<{ id: string }>(db, B, `select id from public.list_challenges('DISCOVER')`)
    expect(discoverB.map((x) => x.id)).toContain(r.challenge_id)
    await rpc(db, B, `select public.join_challenge($1)`, [r.challenge_id])
    expect((await rpc<{ id: string }>(db, B, `select id from public.list_challenges('DISCOVER')`)).map((x) => x.id)).not.toContain(r.challenge_id)
    const mine = await rpc<{ id: string; my_rank: number }>(db, B, `select id, my_rank from public.list_challenges('MINE')`)
    expect(mine.find((x) => x.id === r.challenge_id)).toMatchObject({ my_rank: 1 })
  })
})
