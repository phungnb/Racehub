import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 011800: mục tiêu đăng ký trong Victory Studio, khóa Victory Studio theo gói, Quản trị chính + nhóm quyền admin
const [RUN, PRO, OWN, ADM2, NEW, CAP] = [1, 2, 3, 4, 5, 6].map((n) => `00000000-0000-0000-0000-0000001180${String(n).padStart(2, '0')}`)
const CH = '00000000-0000-0000-0000-00000011800a'
const CH_PRO = '00000000-0000-0000-0000-00000011800b'
const CLUB = '00000000-0000-0000-0000-00000011800c'
type Row = Record<string, any>

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${RUN}', 'run118@x.vn'), ('${PRO}', 'pro118@x.vn'), ('${OWN}', 'own118@x.vn'),
      ('${ADM2}', 'adm118@x.vn'), ('${NEW}', 'new118@x.vn'), ('${CAP}', 'cap118@x.vn');
    insert into public.profiles (id, display_name) values ('${RUN}', 'Runner Free'), ('${PRO}', 'Runner Pro'), ('${OWN}', 'Chủ hệ thống'),
      ('${ADM2}', 'Admin Hai'), ('${NEW}', 'Nhân viên'), ('${CAP}', 'Chủ nhiệm') on conflict do nothing;
    update public.profiles set role = 'SYSTEM_ADMIN' where id in ('${OWN}', '${ADM2}');
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB Pro 118', '${CAP}', 'pro118');
  `)
}
const call = async <T = Row>(db: PGlite, uid: string | null, path: string, sql: string, params: unknown[] = []) =>
  (await asUser<{ r: T }>(db, uid, path, sql, params)).rows[0].r
const rpc = <T = Row>(db: PGlite, uid: string | null, sql: string, params: unknown[] = []) => call<T>(db, uid, '/rpc', sql, params)
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('Chỉnh sửa lần 4 (011800)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`insert into public.challenges (id, title, start_date, end_date, target_value, objective, format, status, created_by, pledge_enabled)
      values ($1, 'Thử thách tuần 40', now() - interval '6 days', now() + interval '1 day', 100, 'DISTANCE', 'RANKED', 'ACTIVE', $2, true)`, [CH, CAP])
    await db.query(`insert into public.challenge_participants (challenge_id, profile_id, status, current_progress, distance_m, moving_s, run_count, pledge_km)
      values ($1, $2, 'JOINED', 10.54, 10540, 3800, 3, 21), ($1, $3, 'JOINED', 11.22, 11220, 4000, 3, null)`, [CH, RUN, PRO])
    await db.query(`insert into public.challenges (id, title, start_date, end_date, target_value, objective, format, status, created_by, target_club_id)
      values ($1, 'Giải CLB Pro', now() - interval '6 days', now() + interval '1 day', 50, 'DISTANCE', 'RANKED', 'ACTIVE', $2, $3)`, [CH_PRO, CAP, CLUB])
    await db.query(`insert into public.challenge_participants (challenge_id, profile_id, status, current_progress, distance_m, moving_s, run_count)
      values ($1, $2, 'JOINED', 8, 8000, 2800, 1)`, [CH_PRO, RUN])
  }, 300_000)

  it('Victory: thử thách tự đăng ký mục tiêu → mục tiêu là km runner đã đăng ký', async () => {
    const f = await rpc(db, RUN, `select public.victory_facts('CHALLENGE', $1) as r`, [CH])
    const goal = f.stats.find((s: Row) => s.key === 'goal')
    expect(goal).toMatchObject({ label: 'Mục tiêu đăng ký', value: '21 km' })
    // Chưa đăng ký mục tiêu → không hiện mục tiêu (không lấy mục tiêu chung của thử thách)
    const g = await rpc(db, PRO, `select public.victory_facts('CHALLENGE', $1) as r`, [CH])
    expect(g.stats.find((s: Row) => s.key === 'goal')).toBeUndefined()
  })

  it('Victory Studio chỉ mở với VIP / CLB Pro / doanh nghiệp / giải của CLB Pro; gói Free bị khóa khi xuất ảnh', async () => {
    expect(await rpc(db, RUN, `select public.victory_access() as r`)).toEqual({ unlocked: false, via: null })
    expect(await fails(rpc(db, RUN, `select public.issue_victory('CHALLENGE', $1) as r`, [CH]))).toContain('VICTORY_LOCKED')
    // Giải do CLB Pro tổ chức: mọi người tham gia đều dùng được cho giải đó
    await db.query(`update public.clubs set plan = 'PRO', pro_until = null where id = $1`, [CLUB])
    expect(await rpc(db, RUN, `select public.victory_access($1) as r`, [CH_PRO])).toEqual({ unlocked: true, via: 'EVENT' })
    expect((await rpc(db, RUN, `select public.issue_victory('CHALLENGE', $1) as r`, [CH_PRO])).code).toMatch(/^[A-Z0-9]{8}$/)
    expect(await fails(rpc(db, RUN, `select public.issue_victory('CHALLENGE', $1) as r`, [CH]))).toContain('VICTORY_LOCKED')
    // Thành viên CLB Pro: mở cho mọi thành tích
    await db.query(`insert into public.club_members (club_id, user_id, role, status) values ($1, $2, 'MEMBER', 'APPROVED')`, [CLUB, PRO])
    expect(await rpc(db, PRO, `select public.victory_access() as r`)).toEqual({ unlocked: true, via: 'CLUB_PRO' })
    expect((await rpc(db, PRO, `select public.issue_victory('CHALLENGE', $1) as r`, [CH])).new).toBe(true)
  })

  it('Quản trị chính chỉ đặt bằng key hệ thống; chỉ Quản trị chính cấp / gỡ / phân quyền; không ai gỡ được Quản trị chính', async () => {
    // Chưa có Quản trị chính → không ai cấp / gỡ được admin trong app
    expect(await fails(rpc(db, ADM2, `select public.admin_set_user_role($1, 'MEMBER', 'thử') as r`, [OWN]))).toContain('OWNER_REQUIRED')
    // Người giữ key hệ thống (SQL Editor) đặt Quản trị chính
    expect((await db.query<{ r: string }>(`select private.admin_set_owner('OWN118@x.vn') as r`)).rows[0].r).toBe('OWNER_SET')
    // App không gọi được hàm đặt Quản trị chính
    expect(await fails(asUser(db, ADM2, '/rpc', `select private.admin_set_owner('adm118@x.vn')`))).toMatch(/permission denied/i)
    // Admin thường không gỡ được Quản trị chính, không cấp quyền được
    expect(await fails(rpc(db, ADM2, `select public.admin_set_user_role($1, 'MEMBER', 'thử') as r`, [OWN]))).toContain('OWNER_ONLY')
    expect(await fails(rpc(db, ADM2, `select public.admin_set_user_role($1, 'SYSTEM_ADMIN', 'thử') as r`, [NEW]))).toContain('OWNER_ONLY')
    expect(await fails(rpc(db, OWN, `select public.admin_set_user_role($1, 'MEMBER', 'thử') as r`, [OWN]))).toContain('CANNOT_TARGET_SELF')
    // Quản trị chính cấp quyền: admin mới chưa có nhóm quyền nào
    await rpc(db, OWN, `select public.admin_set_user_role($1, 'SYSTEM_ADMIN', 'Nhân viên CSKH') as r`, [NEW])
    expect(await fails(call(db, NEW, '/rpc/admin_search_accounts', `select public.admin_search_accounts('') as r`))).toContain('FORBIDDEN')
    expect(await call(db, NEW, '/rpc/admin_inbox', `select public.is_system_admin() as r`)).toBe(true)
    // Phân nhóm quyền Người dùng → tìm tài khoản được, xem nhật ký thì không
    expect(await fails(rpc(db, OWN, `select public.admin_set_permissions($1, array['USERS', 'HACK']) as r`, [NEW]))).toContain('INVALID_SCOPE')
    expect(await rpc(db, OWN, `select public.admin_set_permissions($1, array['users']) as r`, [NEW])).toMatchObject({ scopes: ['USERS'] })
    expect(await call(db, NEW, '/rpc/admin_search_accounts', `select count(*)::int as r from public.admin_search_accounts('')`)).toBeGreaterThanOrEqual(0)
    expect(await fails(call(db, NEW, '/rpc/admin_audit_list', `select public.admin_audit_list() as r`))).toContain('FORBIDDEN')
    // Không có nhóm CLB → không còn toàn quyền trong CLB
    expect(await rpc(db, NEW, `select public.club_role($1, $2) as r`, [CLUB, NEW])).toBeNull()
    expect(await rpc(db, OWN, `select public.club_role($1, $2) as r`, [CLUB, OWN])).toBe('OWNER')
    // Admin thường không phân quyền được cho admin khác; Quản trị chính không bị phân quyền
    expect(await fails(rpc(db, ADM2, `select public.admin_set_permissions($1, array['ECONOMY']) as r`, [NEW]))).toContain('OWNER_ONLY')
    expect(await fails(rpc(db, OWN, `select public.admin_set_permissions($1, array['ECONOMY']) as r`, [RUN]))).toContain('NOT_ADMIN')
    // Hạn dùng: hết hạn → mất quyền admin
    expect(await fails(rpc(db, OWN, `select public.admin_set_permissions($1, array['USERS'], now() - interval '1 day') as r`, [NEW]))).toContain('INVALID_EXPIRY')
    await rpc(db, OWN, `select public.admin_set_permissions($1, array['USERS'], now() + interval '7 days', 'Thời vụ') as r`, [NEW])
    await db.query(`update public.admin_permissions set expires_at = now() - interval '1 minute' where user_id = $1`, [NEW])
    expect(await call(db, NEW, '/rpc/admin_inbox', `select public.is_system_admin() as r`)).toBe(false)
    // Đội quản trị: minh bạch cho mọi admin
    const team = await rpc(db, ADM2, `select public.admin_team() as r`)
    expect(team.owner_exists).toBe(true)
    expect(team.me).toMatchObject({ is_owner: false, legacy: true })
    const byId = Object.fromEntries(team.admins.map((a: Row) => [a.id, a]))
    expect(byId[OWN]).toMatchObject({ is_owner: true })
    expect(byId[NEW]).toMatchObject({ is_owner: false, scopes: ['USERS'], expired: true, note: 'Thời vụ' })
    expect(await fails(rpc(db, RUN, `select public.admin_team() as r`))).toContain('FORBIDDEN')
    // Gỡ quyền: xóa luôn nhóm quyền; Quản trị chính được báo mọi thay đổi (trừ việc tự làm)
    await rpc(db, OWN, `select public.admin_set_user_role($1, 'MEMBER', 'Nghỉ việc') as r`, [NEW])
    expect((await db.query(`select 1 from public.admin_permissions where user_id = $1`, [NEW])).rows).toHaveLength(0)
    expect((await db.query<Row>(`select action from public.admin_audit_log where target = $1 order by id`, ['user:' + NEW])).rows.map((r: Row) => r.action))
      .toEqual(['USER_ROLE', 'ADMIN_SCOPES', 'ADMIN_SCOPES', 'USER_ROLE'])
  })
})
