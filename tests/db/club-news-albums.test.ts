import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 006300: Tin CLB của ban chủ nhiệm + kho link ảnh CLB
const OWNER = '00000000-0000-0000-0000-0000000063c1'
const MEM = '00000000-0000-0000-0000-0000000063c2'
const MEM2 = '00000000-0000-0000-0000-0000000063c3'
const OUT = '00000000-0000-0000-0000-0000000063c4'
const CLUB = '00000000-0000-0000-0000-0000000063b0'
const EV = '00000000-0000-0000-0000-0000000063e1'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@x.vn'), ('${MEM}', 'm@x.vn'), ('${MEM2}', 'm2@x.vn'), ('${OUT}', 'out@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${OWNER}', 'Chủ nhiệm', 0, 0, 1, now()), ('${MEM}', 'Lan', 0, 0, 1, now()), ('${MEM2}', 'Vũ', 0, 0, 1, now()), ('${OUT}', 'Người ngoài', 0, 0, 1, now());
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'Hồ Tây Runners', '${OWNER}', 'hotay63');
    insert into public.club_members (club_id, user_id, role, status) values
      ('${CLUB}', '${OWNER}', 'OWNER', 'APPROVED'), ('${CLUB}', '${MEM}', 'MEMBER', 'APPROVED'), ('${CLUB}', '${MEM2}', 'MEMBER', 'APPROVED');
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const news = (db: PGlite, u: string, p: object) => rpc<string>(db, u, `select public.publish_club_news($1, $2::jsonb) as r`, [CLUB, JSON.stringify(p)])
const album = (db: PGlite, u: string, p: object) => rpc<string>(db, u, `select public.save_club_album($1, $2::jsonb) as r`, [CLUB, JSON.stringify(p)])
const albums = (db: PGlite, u: string, p: object = {}) => rpc<Row>(db, u, `select public.club_albums($1, $2::jsonb) as r`, [CLUB, JSON.stringify(p)])

describe('CLB: Tin CLB + kho link ảnh (006300)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`insert into public.club_events (id, club_id, created_by, title, starts_at) values ($1, $2, $3, 'Long run Hồ Tây', now() - interval '2 days')`, [EV, CLUB, OWNER])
  }, 240_000)

  it('chỉ ban chủ nhiệm đăng Tin CLB; có chuyên mục, link; ghim + gửi thông báo tuỳ chọn; sửa được', async () => {
    expect(await fails(news(db, MEM, { title: 'Tin giả', category: 'NOTICE' }))).toContain('FORBIDDEN')
    expect(await fails(news(db, OWNER, { title: 'x' }))).toContain('TITLE_REQUIRED')
    expect(await fails(news(db, OWNER, { title: 'Giải VnExpress', link: 'javascript:alert(1)' }))).toContain('INVALID_URL')
    expect(await fails(news(db, OWNER, { title: 'Giải VnExpress', image_paths: [`${CLUB}/${MEM}/a.jpg`] }))).toContain('INVALID_IMAGE_PATH')
    const id = await news(db, OWNER, { title: 'Mở đăng ký giải Hà Nội Marathon', body: 'CLB đăng ký theo đoàn, hạn 30/10.', category: 'RACE',
      link: 'https://example.com/giai', image_paths: [`${CLUB}/${OWNER}/banner.jpg`], pin: true, notify: true })
    const p = (await db.query<Row>(`select kind, title, is_pinned, meta from public.club_posts where id = $1`, [id])).rows[0]
    expect(p).toMatchObject({ kind: 'NEWS', is_pinned: true, meta: { category: 'RACE', link: 'https://example.com/giai' } })
    const n = await db.query<Row>(`select user_id, link from public.notifications where kind = 'CLUB_NEWS' order by user_id`)
    expect(n.rows.map((r) => r.user_id)).toEqual([MEM, MEM2])
    expect(n.rows[0].link).toBe(`/clubs/${CLUB}?post=${id}`)
    await news(db, OWNER, { id, title: 'Mở đăng ký giải Hà Nội Marathon (cập nhật)', category: 'RACE', image_paths: [`${CLUB}/${OWNER}/banner.jpg`], pin: false })
    expect((await db.query<Row>(`select title, is_pinned from public.club_posts where id = $1`, [id])).rows[0]).toEqual({ title: 'Mở đăng ký giải Hà Nội Marathon (cập nhật)', is_pinned: false })
    // Tin không gửi thông báo thì không làm phiền
    await news(db, OWNER, { title: 'Kết quả tháng 9', category: 'RESULT' })
    expect((await db.query<Row>(`select count(*)::int c from public.notifications where kind = 'CLUB_NEWS'`)).rows[0].c).toBe(2)
  })

  it('kho ảnh: ban chủ nhiệm thêm ngay; thành viên gửi chờ duyệt; lọc, tìm không dấu, theo sự kiện; người ngoài không xem được', async () => {
    const a1 = await album(db, OWNER, { title: 'Ảnh Long run Hồ Tây', url: 'https://photos.app.goo.gl/abc', kind: 'EVENT', event_id: EV, taken_on: '2026-09-20', photographer: 'Minh', notify: true })
    await album(db, OWNER, { title: 'VnExpress Marathon Huế 2025', url: 'https://drive.google.com/drive/folders/x', kind: 'RACE', race_name: 'VM Huế', taken_on: '2025-04-06' })
    expect(await fails(album(db, OWNER, { title: 'Trùng link', url: 'https://photos.app.goo.gl/abc' }))).toContain('ALBUM_EXISTS')
    expect(await fails(album(db, MEM, { title: 'Link lạ', url: 'ftp://x' }))).toContain('INVALID_URL')
    const pending = await album(db, MEM, { title: 'Ảnh mình chụp buổi tập', url: 'https://www.facebook.com/media/set/?set=a.1', kind: 'TRAINING' })
    expect((await db.query<Row>(`select status from public.club_albums where id = $1`, [pending])).rows[0].status).toBe('PENDING')

    const mem2 = await albums(db, MEM2)
    expect(mem2.items.map((x: Row) => x.title)).toEqual(['Ảnh Long run Hồ Tây', 'VnExpress Marathon Huế 2025'])    // chưa thấy link chờ duyệt
    expect(mem2).toMatchObject({ total: 2, years: [2026, 2025], pending: 0, can_manage: false })
    expect((await albums(db, MEM)).items[0]).toMatchObject({ id: pending, status: 'PENDING' })                       // người gửi thấy link của mình
    expect((await albums(db, OWNER)).pending).toBe(1)
    expect((await albums(db, MEM2, { q: 'ho tay' })).items[0].id).toBe(a1)
    expect((await albums(db, MEM2, { q: 'vm hue' })).total).toBe(1)
    expect((await albums(db, MEM2, { kind: 'RACE' })).total).toBe(1)
    expect((await albums(db, MEM2, { year: 2025 })).items[0].title).toBe('VnExpress Marathon Huế 2025')
    expect((await albums(db, MEM2, { event_id: EV })).items[0]).toMatchObject({ id: a1, event_title: 'Long run Hồ Tây' })
    expect(await fails(albums(db, OUT))).toContain('NOT_A_MEMBER')

    expect(await fails(rpc(db, MEM2, `select public.review_club_album($1, true)`, [pending]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, MEM2, `select public.delete_club_album($1)`, [a1]))).toContain('FORBIDDEN')
    await rpc(db, OWNER, `select public.review_club_album($1, true)`, [pending])
    expect((await albums(db, MEM2)).total).toBe(3)
    expect(await fails(album(db, MEM, { id: pending, title: 'Sửa sau duyệt', url: 'https://www.facebook.com/media/set/?set=a.1' }))).toContain('FORBIDDEN')
    await rpc(db, MEM2, `select public.open_club_album($1)`, [a1])
    expect((await db.query<Row>(`select opens from public.club_albums where id = $1`, [a1])).rows[0].opens).toBe(1)
    const notes = await db.query<Row>(`select user_id, title from public.notifications where kind = 'CLUB_ALBUM' order by created_at`)
    expect(notes.rows.some((r) => r.user_id === OWNER && r.title === 'Link ảnh chờ duyệt')).toBe(true)
    expect(notes.rows.some((r) => r.user_id === MEM && r.title === 'Album của bạn đã được duyệt')).toBe(true)
    expect(await fails(rpc(db, MEM, `select * from public.club_albums`))).toMatch(/permission|denied/i)
  })
})
