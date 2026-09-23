import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 001500: sự kiện CLB, điểm danh (QR / tự động / ban quản trị), thu chi VND, bình chọn, huy hiệu chạy nhóm
const OWNER = '00000000-0000-0000-0000-0000000000c1'
const MEM = '00000000-0000-0000-0000-0000000000c2'
const MEM2 = '00000000-0000-0000-0000-0000000000c3'
const OUT = '00000000-0000-0000-0000-0000000000c4'
const CLUB = '00000000-0000-0000-0000-00000000c1b0'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@x.vn'), ('${MEM}', 'm@x.vn'), ('${MEM2}', 'm2@x.vn'), ('${OUT}', 'out@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${OWNER}', 'Chủ nhiệm', 0, 0, 1, now()), ('${MEM}', 'Lan', 0, 0, 1, now()), ('${MEM2}', 'Vũ', 0, 0, 1, now()), ('${OUT}', 'Người ngoài', 0, 0, 1, now());
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'Hồ Tây Runners', '${OWNER}', 'hotay9');
    insert into public.club_members (club_id, user_id, role, status) values
      ('${CLUB}', '${OWNER}', 'OWNER', 'APPROVED'), ('${CLUB}', '${MEM}', 'MEMBER', 'APPROVED'), ('${CLUB}', '${MEM2}', 'MEMBER', 'APPROVED');
  `)
}

type Row = Record<string, unknown>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) =>
  (await asUser<T>(db, uid, '/rpc', sql, params)).rows
const one = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await rpc<{ r: T }>(db, uid, sql, params))[0].r
const fails = async (db: PGlite, uid: string, sql: string, params: unknown[] = []) => {
  try { await asUser(db, uid, '/rpc', sql, params) } catch (e) { return (e as Error).message }
  return 'OK'
}
const iso = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()
type Ev = { id: string; going_count: number; checked_in_count: number; my_status: string | null; my_checked_in_at: string | null
  attendees: { user_id: string; checked_in_at: string | null; checkin_method: string | null }[]; can_manage: boolean; checkin_open: boolean }

describe('CLB: sự kiện + điểm danh (001500)', () => {
  let db: PGlite
  let ev: string
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('chỉ ban quản trị tạo sự kiện; thành viên được thông báo; người tạo mặc định tham gia', async () => {
    const body = { title: 'Chạy dài Chủ nhật', starts_at: iso(60), duration_min: 120, location_name: 'Hồ Tây', lat: 21.0583, lng: 105.8235, distance_km: 15, pace_text: '6:00–6:30', capacity: 3 }
    expect(await fails(db, MEM, `select public.create_club_event($1, $2::jsonb)`, [CLUB, JSON.stringify(body)])).toContain('FORBIDDEN')
    expect(await fails(db, OWNER, `select public.create_club_event($1, $2::jsonb)`, [CLUB, JSON.stringify({ ...body, title: 'x' })])).toContain('INVALID_TITLE')
    expect(await fails(db, OWNER, `select public.create_club_event($1, $2::jsonb)`, [CLUB, JSON.stringify({ ...body, lng: null })])).toContain('INVALID_LOCATION')
    const r = await one<Ev>(db, OWNER, `select public.create_club_event($1, $2::jsonb) as r`, [CLUB, JSON.stringify(body)])
    ev = r.id
    expect(r).toMatchObject({ going_count: 1, my_status: 'GOING' })
    const n = await db.query(`select title, link from public.notifications where user_id = $1 and kind = 'CLUB_EVENT'`, [MEM])
    expect(n.rows).toEqual([{ title: 'Sự kiện mới: Chạy dài Chủ nhật', link: `/clubs/${CLUB}/events/${ev}` }])
    // khóa ký QR không lộ ra ngoài
    expect(await fails(db, MEM, `select * from private.club_event_secrets`)).toMatch(/permission denied/)
  })

  it('báo tham gia: đủ chỗ thì từ chối; người ngoài CLB không xem / không báo được', async () => {
    await rpc(db, MEM, `select public.rsvp_club_event($1, 'GOING')`, [ev])
    await rpc(db, MEM2, `select public.rsvp_club_event($1, 'MAYBE')`, [ev])
    const list = await one<Ev[]>(db, MEM, `select public.club_events($1) as r`, [CLUB])
    expect(list[0]).toMatchObject({ going_count: 2, my_status: 'GOING' })
    expect(await fails(db, OUT, `select public.club_events($1)`, [CLUB])).toContain('NOT_A_MEMBER')
    expect(await fails(db, OUT, `select public.rsvp_club_event($1, 'GOING')`, [ev])).toContain('NOT_A_MEMBER')
    expect((await rpc(db, OUT, `select id from public.club_events`))).toHaveLength(0)
    // capacity 3: thêm 1 người GOING nữa là đầy
    await rpc(db, MEM2, `select public.rsvp_club_event($1, 'GOING')`, [ev])
    await db.exec(`insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c5', 'x@x.vn');
      insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('00000000-0000-0000-0000-0000000000c5', 'Tú', 0, 0, 1, now())
        on conflict (id) do nothing;
      insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '00000000-0000-0000-0000-0000000000c5', 'MEMBER', 'APPROVED');`)
    expect(await fails(db, '00000000-0000-0000-0000-0000000000c5', `select public.rsvp_club_event($1, 'GOING')`, [ev])).toContain('EVENT_FULL')
  })

  it('điểm danh QR: mã đúng thì được, mã giả / hết hạn / người ngoài bị từ chối; có huy hiệu chạy nhóm', async () => {
    expect(await fails(db, MEM, `select public.event_checkin_token($1)`, [ev])).toContain('FORBIDDEN')
    const t = await one<{ token: string }>(db, OWNER, `select public.event_checkin_token($1) as r`, [ev])
    const r = await one<{ new: boolean }>(db, MEM, `select public.checkin_club_event($1) as r`, [t.token])
    expect(r.new).toBe(true)
    expect((await one<{ new: boolean }>(db, MEM, `select public.checkin_club_event($1) as r`, [t.token])).new).toBe(false)
    const [id, exp, sig] = t.token.split('.')
    expect(await fails(db, MEM2, `select public.checkin_club_event($1)`, [`${id}.${Number(exp) + 999}.${sig}`])).toContain('INVALID_TOKEN')
    expect(await fails(db, MEM2, `select public.checkin_club_event($1)`, ['rac.rac.rac'])).toContain('INVALID_TOKEN')
    expect(await fails(db, OUT, `select public.checkin_club_event($1)`, [t.token])).toContain('NOT_A_MEMBER')
    // mã hết hạn: tự ký mã với exp trong quá khứ bằng khóa thật
    const old = (await db.query<{ s: string }>(`select private.event_sig($1, 1000) as s`, [ev])).rows[0].s
    expect(await fails(db, MEM2, `select public.checkin_club_event($1)`, [`${ev}.1000.${old}`])).toContain('TOKEN_EXPIRED')
    const badge = await db.query(`select 1 from public.user_achievements ua join public.achievements a on a.id = ua.achievement_id
      where ua.user_id = $1 and a.code = 'GROUP_RUN_1'`, [MEM])
    expect(badge.rows).toHaveLength(1)
  })

  it('ban quản trị điểm danh tay và bỏ điểm danh', async () => {
    await rpc(db, OWNER, `select public.staff_checkin($1, $2, true)`, [ev, MEM2])
    let d = await one<Ev>(db, MEM, `select public.club_event($1) as r`, [ev])
    expect(d.checked_in_count).toBe(2)
    expect(d.attendees.find((a) => a.user_id === MEM2)?.checkin_method).toBe('STAFF')
    await rpc(db, OWNER, `select public.staff_checkin($1, $2, false)`, [ev, MEM2])
    d = await one<Ev>(db, MEM, `select public.club_event($1) as r`, [ev])
    expect(d.checked_in_count).toBe(1)
    expect(d).toMatchObject({ can_manage: false, checkin_open: true })
    expect(await fails(db, MEM, `select public.staff_checkin($1, $2, true)`, [ev, MEM2])).toContain('FORBIDDEN')
  })

  it('tự điểm danh từ bài chạy: đúng giờ + gần điểm hẹn; sai chỗ thì không', async () => {
    // Như luồng thật (submit_and_process_activity): chèn bài APPROVED (được thưởng ngay) + điểm GPS trong cùng một giao dịch
    const run = async (uid: string, lat: number, lng: number, minutesFromNow: number) => {
      const id = crypto.randomUUID()
      await db.exec(`begin;
        insert into public.activities (id, user_id, source, started_at, ended_at, distance_m, moving_time_s, validation_status)
          values ('${id}', '${uid}', 'DIRECT_GPS', '${iso(minutesFromNow)}', '${iso(minutesFromNow + 60)}', 10000, 3600, 'APPROVED');
        insert into public.activity_track_points (activity_id, sequence, latitude, longitude, recorded_at) values ('${id}', 1, ${lat}, ${lng}, now());
        commit;`)
      const r = await db.query<{ rewarded_at: string | null }>(`select rewarded_at from public.activities where id = $1`, [id])
      expect(r.rows[0].rewarded_at).not.toBeNull()
    }
    await run(MEM2, 21.0590, 105.8240, 70)       // ~90 m, 10 phút sau giờ hẹn
    await run(OWNER, 21.0300, 105.8500, 60)      // ~4 km: không tính
    const d = await one<Ev>(db, OWNER, `select public.club_event($1) as r`, [ev])
    expect(d.attendees.find((a) => a.user_id === MEM2)).toMatchObject({ checkin_method: 'AUTO' })
    expect(d.attendees.find((a) => a.user_id === OWNER)?.checked_in_at).toBeNull()
  })

  it('hủy sự kiện có lý do → báo người tham gia; nhắc trước 12 giờ chỉ một lần', async () => {
    const e2 = await one<Ev>(db, OWNER, `select public.create_club_event($1, $2::jsonb) as r`,
      [CLUB, JSON.stringify({ title: 'Chạy tốc độ', starts_at: iso(300) })])
    await rpc(db, MEM, `select public.rsvp_club_event($1, 'GOING')`, [e2.id])
    await rpc(db, MEM, `select public.club_events($1)`, [CLUB])           // nhắc lười khi mở danh sách
    await rpc(db, MEM, `select public.club_events($1)`, [CLUB])
    const rem = await db.query(`select count(*)::int c from public.notifications where user_id = $1 and title = 'Sắp tới: Chạy tốc độ'`, [MEM])
    expect(rem.rows[0]).toEqual({ c: 1 })
    expect(await fails(db, OWNER, `select public.cancel_club_event($1, '')`, [e2.id])).toContain('REASON_REQUIRED')
    await rpc(db, OWNER, `select public.cancel_club_event($1, 'Mưa lớn')`, [e2.id])
    const c = await db.query(`select body from public.notifications where user_id = $1 and title = 'Đã hủy: Chạy tốc độ'`, [MEM])
    expect(c.rows).toEqual([{ body: 'Mưa lớn' }])
    expect(await fails(db, MEM, `select public.rsvp_club_event($1, 'GOING')`, [e2.id])).toContain('EVENT_CANCELLED')
  })
})

describe('CLB: thu chi VND + bình chọn (001500)', () => {
  let db: PGlite
  let due: string
  type Fin = { balance: number; bank: Row | null; dues: { id: string; confirmed: number; claimed: number; total: number; my_status: string }[]
    entries: { kind: string; amount_vnd: number; voided_at: string | null }[]; can_manage: boolean }
  beforeAll(async () => { db = await createDb({ withMigrations: true, seed }) }, 240_000)

  it('tài khoản ngân hàng CLB: chỉ ban quản trị, kiểm tra định dạng', async () => {
    expect(await fails(db, MEM, `select public.set_club_bank($1, '970436', '0123456789', 'Nguyen Van A')`, [CLUB])).toContain('FORBIDDEN')
    expect(await fails(db, OWNER, `select public.set_club_bank($1, '97043', '0123456789', 'Nguyen Van A')`, [CLUB])).toContain('INVALID_BANK')
    await rpc(db, OWNER, `select public.set_club_bank($1, '970436', '0123456789', 'Nguyen Van A')`, [CLUB])
    const f = await one<Fin>(db, MEM, `select public.club_finance($1) as r`, [CLUB])
    expect(f.bank).toEqual({ bin: '970436', account_no: '0123456789', account_name: 'NGUYEN VAN A' })
  })

  it('kỳ thu phí: báo đã chuyển → xác nhận → vào sổ; bỏ xác nhận thì hủy bút toán', async () => {
    due = (await rpc<{ id: string }>(db, OWNER, `select public.create_club_due($1, 'Phí tháng 10', 100000, '2026-10-10', null) as id`, [CLUB]))[0].id
    await rpc(db, MEM, `select public.claim_due_paid($1)`, [due])
    let f = await one<Fin>(db, MEM, `select public.club_finance($1) as r`, [CLUB])
    expect(f.dues[0]).toMatchObject({ total: 3, claimed: 1, confirmed: 0, my_status: 'CLAIMED' })
    expect(await fails(db, MEM, `select public.set_due_payment($1, $2, 'CONFIRMED')`, [due, MEM])).toContain('FORBIDDEN')
    await rpc(db, OWNER, `select public.set_due_payment($1, $2, 'CONFIRMED')`, [due, MEM])
    await rpc(db, OWNER, `select public.set_due_payment($1, $2, 'CONFIRMED')`, [due, MEM])      // bấm 2 lần không cộng 2 lần
    await rpc(db, OWNER, `select public.set_due_payment($1, $2, 'EXEMPT')`, [due, MEM2])
    f = await one<Fin>(db, MEM, `select public.club_finance($1) as r`, [CLUB])
    expect(Number(f.balance)).toBe(100000)
    expect(f.dues[0]).toMatchObject({ total: 2, confirmed: 1 })
    await rpc(db, OWNER, `select public.set_due_payment($1, $2, 'UNPAID')`, [due, MEM])
    f = await one<Fin>(db, MEM, `select public.club_finance($1) as r`, [CLUB])
    expect(Number(f.balance)).toBe(0)
    await rpc(db, OWNER, `select public.set_due_payment($1, $2, 'CONFIRMED')`, [due, MEM])
    const detail = await one<{ members: { user_id: string; status: string }[] }>(db, MEM2, `select public.club_due_detail($1) as r`, [due])
    expect(detail.members.find((m) => m.user_id === MEM)?.status).toBe('CONFIRMED')
  })

  it('nhắc người chưa đóng (một lần / 12 giờ); khoản chi có hóa đơn; hủy khoản cần lý do', async () => {
    expect(await rpc<{ n: number }>(db, OWNER, `select public.remind_due($1) as n`, [due])).toEqual([{ n: 1 }])
    expect(await fails(db, OWNER, `select public.remind_due($1)`, [due])).toContain('REMIND_TOO_SOON')
    const id = (await rpc<{ id: string }>(db, OWNER, `select public.add_cash_entry($1, 'EXPENSE', 30000, 'Nước uống', null, 'https://x.supabase.co/a.jpg') as id`, [CLUB]))[0].id
    expect(await fails(db, OWNER, `select public.add_cash_entry($1, 'EXPENSE', 30000, 'Nước', null, 'javascript:1')`, [CLUB])).toContain('INVALID_RECEIPT')
    expect(await fails(db, MEM, `select public.add_cash_entry($1, 'INCOME', 30000, 'Tài trợ', null, null)`, [CLUB])).toContain('FORBIDDEN')
    let f = await one<Fin>(db, MEM, `select public.club_finance($1) as r`, [CLUB])
    expect(Number(f.balance)).toBe(70000)
    expect(await fails(db, OWNER, `select public.void_cash_entry($1, 'sai')`, [id])).toContain('REASON_REQUIRED')
    await rpc(db, OWNER, `select public.void_cash_entry($1, 'Nhập nhầm số tiền')`, [id])
    f = await one<Fin>(db, MEM, `select public.club_finance($1) as r`, [CLUB])
    expect(Number(f.balance)).toBe(100000)
    expect(f.entries.find((e) => e.kind === 'EXPENSE')?.voided_at).not.toBeNull()
    expect(await fails(db, MEM, `insert into public.club_cash_entries (club_id, kind, amount_vnd, title) values ($1, 'INCOME', 1000000, 'Hack')`, [CLUB])).toMatch(/permission denied/)
    expect(await fails(db, OUT, `select public.club_finance($1)`, [CLUB])).toContain('NOT_A_MEMBER')
  })

  it('bình chọn: một / nhiều lựa chọn, đổi phiếu, ẩn kết quả tới khi đóng', async () => {
    const p = (await rpc<{ id: string }>(db, MEM, `select public.create_club_poll($1, 'Chạy ở đâu Chủ nhật?', array['Hồ Tây', 'Công viên Yên Sở', 'Cầu Long Biên'], false, null, true) as id`, [CLUB]))[0].id
    expect(await fails(db, MEM, `select public.create_club_poll($1, 'Hỏi gì?', array['Một'], false, null, false)`, [CLUB])).toContain('INVALID_OPTIONS')
    await rpc(db, MEM, `select public.vote_club_poll($1, array[0])`, [p])
    await rpc(db, MEM2, `select public.vote_club_poll($1, array[1])`, [p])
    await rpc(db, MEM2, `select public.vote_club_poll($1, array[0])`, [p])                        // đổi phiếu
    expect(await fails(db, MEM2, `select public.vote_club_poll($1, array[0, 1])`, [p])).toContain('INVALID_CHOICES')
    expect(await fails(db, MEM2, `select public.vote_club_poll($1, array[5])`, [p])).toContain('INVALID_CHOICES')
    type Poll = { counts: number[] | null; voters: number; my_choices: number[]; closed: boolean }
    let polls = await one<Poll[]>(db, MEM2, `select public.club_polls($1) as r`, [CLUB])
    expect(polls[0]).toMatchObject({ counts: null, voters: 2, my_choices: [0], closed: false })     // ẩn kết quả
    expect((await one<Poll[]>(db, OWNER, `select public.club_polls($1) as r`, [CLUB]))[0].counts).toEqual([2, 0, 0])
    expect(await fails(db, MEM2, `select public.close_club_poll($1)`, [p])).toContain('FORBIDDEN')
    await rpc(db, MEM, `select public.close_club_poll($1)`, [p])
    polls = await one<Poll[]>(db, MEM2, `select public.club_polls($1) as r`, [CLUB])
    expect(polls[0]).toMatchObject({ counts: [2, 0, 0], closed: true })
    expect(await fails(db, MEM2, `select public.vote_club_poll($1, array[1])`, [p])).toContain('POLL_CLOSED')
    expect(await fails(db, MEM2, `select * from public.club_poll_votes where user_id = $1`, [MEM])).toBe('OK')
    expect((await rpc(db, MEM2, `select * from public.club_poll_votes where user_id = $1`, [MEM]))).toHaveLength(0)
  })
})
