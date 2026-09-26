import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 006200: RaceHub Knowledge — bài viết / tin tức, CMS có duyệt chuyên môn, tiến độ đọc, chuỗi bài → huy hiệu
const id = (n: number) => `00000000-0000-0000-0000-0000000062${String(n).padStart(2, '0')}`
const [READER, ADM, WRITER, EDITOR, EXPERT] = [1, 2, 3, 4, 5].map(id)

async function seed(db: PGlite) {
  const users = [READER, ADM, WRITER, EDITOR, EXPERT]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'k${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'Người ${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const save = (db: PGlite, u: string, p: object) => rpc<string>(db, u, `select public.cms_save($1::jsonb) as r`, [JSON.stringify(p)])
const status = (db: PGlite, u: string, a: string, s: string, at: string | null = null, note: string | null = null) =>
  rpc(db, u, `select public.cms_set_status($1, $2, $3::timestamptz, $4) as r`, [a, s, at, note])
const approve = (db: PGlite, u: string, a: string) => rpc(db, u, `select public.cms_expert_review($1, true, 'Đúng chuyên môn')`, [a])
const article = (db: PGlite, u: string, slug: string) => rpc<Row>(db, u, `select public.knowledge_article($1) as r`, [slug])
const list = (db: PGlite, u: string, p: object = {}) => rpc<Row>(db, u, `select public.knowledge_list($1::jsonb) as r`, [JSON.stringify(p)])
const artId = async (db: PGlite, slug: string) => (await db.query<Row>(`select id from public.content_articles where slug = $1`, [slug])).rows[0].id as string
const BODY = 'Chạy chậm tới mức nói chuyện được. '.repeat(30)

describe('RaceHub Knowledge (006200)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
  }, 240_000)

  it('người đọc chỉ thấy bài đã đăng; lọc chuyên mục / loại / tìm không dấu; mở bài đếm 1 lượt xem mỗi ngày', async () => {
    const home = await rpc<Row>(db, READER, `select public.knowledge_home() as r`)
    expect(home.categories).toHaveLength(8)
    expect(home.featured.map((a: Row) => a.slug)).toContain('xp-xu-level-hoat-dong-the-nao')
    expect(home.featured.map((a: Row) => a.slug)).not.toContain('lo-trinh-0-den-5-km')          // chờ duyệt chuyên môn
    expect(home.news.map((a: Row) => a.slug)).toEqual(['tim-ban-chay-voi-quanh-day'])
    expect(home.series).toHaveLength(0)                                                        // chuỗi chưa có bài nào đăng

    expect((await list(db, READER, { category: 'APP' })).total).toBe(4)
    expect((await list(db, READER, { type: 'NEWS' })).total).toBe(1)
    expect((await list(db, READER, { q: 'thu thach' })).items[0].slug).toBe('tham-gia-thu-thach-dau-tien')

    const a = await article(db, READER, 'xp-xu-level-hoat-dong-the-nao')
    expect(a).toMatchObject({ category: { id: 'APP' }, author: { name: 'Ban biên tập RaceHub' }, preview: false })
    expect(a.ctas.map((c: Row) => c.kind)).toEqual(['GOAL', 'CHALLENGES'])
    await article(db, READER, 'xp-xu-level-hoat-dong-the-nao')
    expect((await db.query<Row>(`select views from public.content_articles where slug = 'xp-xu-level-hoat-dong-the-nao'`)).rows[0].views).toBe(1)
    expect(await fails(article(db, READER, 'lo-trinh-0-den-5-km'))).toContain('ARTICLE_NOT_FOUND')
    expect(await fails(rpc(db, READER, `select * from public.content_articles`))).toMatch(/permission|denied/i)
  })

  it('CMS: chỉ ban nội dung; người viết gửi duyệt, không tự đăng; bài giáo án phải qua duyệt chuyên môn', async () => {
    expect(await fails(rpc(db, READER, `select public.cms_list('{}'::jsonb) as r`))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, EDITOR, `select public.cms_set_staff($1, 'EDITOR')`, [EDITOR]))).toContain('FORBIDDEN')
    await rpc(db, ADM, `select public.cms_set_staff($1, 'WRITER')`, [WRITER])
    await rpc(db, ADM, `select public.cms_set_staff($1, 'EDITOR')`, [EDITOR])
    await rpc(db, ADM, `select public.cms_set_staff($1, 'EXPERT')`, [EXPERT])
    expect(await rpc<string>(db, WRITER, `select public.my_content_role() as r`)).toBe('WRITER')

    const a = await save(db, WRITER, { title: 'Giáo án 10K đầu tiên', body: BODY, category_id: 'TRAINING', tags: ['10K', 'Giáo án'],
      sources: [{ title: 'Sách chạy bộ', url: 'https://example.com/a' }], ctas: [{ kind: 'CHALLENGES' }, { kind: 'BAD' }, { kind: 'LINK', target: '//evil.com' }] })
    const got = await rpc<Row>(db, WRITER, `select public.cms_get($1) as r`, [a])
    expect(got).toMatchObject({ slug: 'giao-an-10k-dau-tien', status: 'DRAFT', needs_expert_review: true, tags: ['10K', 'Giáo án'] })
    expect(got.ctas).toEqual([{ kind: 'CHALLENGES', target: null, label: null }])                 // bỏ loại lạ + link ngoài
    expect(await fails(status(db, WRITER, a, 'PUBLISHED'))).toContain('FORBIDDEN')
    await status(db, WRITER, a, 'REVIEW')
    expect(await fails(status(db, EDITOR, a, 'PUBLISHED'))).toContain('EXPERT_REVIEW_REQUIRED')
    expect(await fails(rpc(db, EDITOR, `select public.cms_expert_review($1, true)`, [a]))).toContain('FORBIDDEN')
    await approve(db, EXPERT, a)
    await status(db, EDITOR, a, 'PUBLISHED')
    expect((await article(db, READER, 'giao-an-10k-dau-tien')).expert_name).toBe('Người 4')
    expect(await fails(save(db, WRITER, { id: a, title: 'Giáo án 10K đầu tiên', body: BODY + 'x', category_id: 'TRAINING' }))).toContain('FORBIDDEN')

    // biên tập viên sửa nội dung chuyên môn → mất duyệt, bài tự gỡ về chờ duyệt
    await save(db, EDITOR, { id: a, title: 'Giáo án 10K đầu tiên', body: BODY + ' Thêm tuần nghỉ.', category_id: 'TRAINING' })
    expect((await rpc<Row>(db, EDITOR, `select public.cms_get($1) as r`, [a]))).toMatchObject({ status: 'REVIEW', expert_reviewed_at: null })
    expect(await fails(article(db, READER, 'giao-an-10k-dau-tien'))).toContain('ARTICLE_NOT_FOUND')
    expect((await article(db, WRITER, 'giao-an-10k-dau-tien')).preview).toBe(true)                 // ban nội dung xem trước

    // hẹn giờ: chưa tới giờ thì chưa hiện
    const n = await save(db, EDITOR, { title: 'Giải chạy mùa thu', body: BODY, category_id: 'RACES', content_type: 'NEWS' })
    expect(await fails(status(db, EDITOR, n, 'SCHEDULED', new Date(Date.now() - 60_000).toISOString()))).toContain('INVALID_SCHEDULE')
    await status(db, EDITOR, n, 'SCHEDULED', new Date(Date.now() + 3_600_000).toISOString())
    expect(await fails(article(db, READER, 'giai-chay-mua-thu'))).toContain('ARTICLE_NOT_FOUND')
    await db.query(`update public.content_articles set published_at = now() - interval '1 minute' where id = $1`, [n])
    expect((await article(db, READER, 'giai-chay-mua-thu')).content_type).toBe('NEWS')
    expect(await fails(rpc(db, EDITOR, `select public.cms_delete($1)`, [n]))).toContain('ARCHIVE_INSTEAD')
    expect((await db.query<Row>(`select count(*)::int c from public.admin_audit_log where action like 'CONTENT_%'`)).rows[0].c).toBeGreaterThan(3)
  })

  it('đọc xong cần cuộn hết + đủ thời gian; hết chuỗi "Bắt đầu chạy bộ" → huy hiệu, không cộng XP / Xu; lưu, phản hồi, chia sẻ đếm 1 lần / ngày', async () => {
    for (const s of ['lo-trinh-0-den-5-km', 'chon-giay-chay-bo-dau-tien', 'easy-tempo-interval-khac-nhau', 'khi-nao-bo-sung-nuoc-va-gel']) {
      const a = await artId(db, s)
      if ((await rpc<Row>(db, ADM, `select public.cms_get($1) as r`, [a])).needs_expert_review) await approve(db, EXPERT, a)
      await status(db, EDITOR, a, 'PUBLISHED')
    }
    const home = await rpc<Row>(db, READER, `select public.knowledge_home() as r`)
    expect(home.series[0]).toMatchObject({ id: 'STARTER', total: 4, done: 0, next_slug: 'lo-trinh-0-den-5-km' })

    const ids = await Promise.all(['lo-trinh-0-den-5-km', 'chon-giay-chay-bo-dau-tien', 'easy-tempo-interval-khac-nhau', 'khi-nao-bo-sung-nuoc-va-gel'].map((s) => artId(db, s)))
    expect(await rpc<Row>(db, READER, `select public.knowledge_progress($1, 100, 2) as r`, [ids[0]])).toMatchObject({ completed: false })   // lướt nhanh ≠ đọc
    const r1 = await rpc<Row>(db, READER, `select public.knowledge_progress($1, 100, 120) as r`, [ids[0]])
    expect(r1).toMatchObject({ completed: true, just_completed: true, badge: null })
    for (const a of ids.slice(1, 3)) await rpc(db, READER, `select public.knowledge_progress($1, 95, 120) as r`, [a])
    const last = await rpc<Row>(db, READER, `select public.knowledge_progress($1, 100, 120) as r`, [ids[3]])
    expect(last).toMatchObject({ just_completed: true, badge: 'LEARN_STARTER' })
    expect((await rpc<Row>(db, READER, `select public.knowledge_progress($1, 100, 120) as r`, [ids[3]])).just_completed).toBe(false)
    const badges = await db.query<Row>(`select count(*)::int c from public.user_achievements ua join public.achievements a on a.id = ua.achievement_id
                                         where ua.user_id = $1 and a.code = 'LEARN_STARTER'`, [READER])
    expect(badges.rows[0].c).toBe(1)
    expect((await db.query<Row>(`select xp, xu::float8 xu from public.profiles where id = $1`, [READER])).rows[0]).toEqual({ xp: 0, xu: 0 })
    expect((await db.query<Row>(`select reads from public.content_articles where id = $1`, [ids[0]])).rows[0].reads).toBe(1)

    await rpc(db, READER, `select public.knowledge_bookmark($1, true) as r`, [ids[1]])
    await rpc(db, READER, `select public.knowledge_bookmark($1, true) as r`, [ids[1]])
    expect((await list(db, READER, { saved: true })).items.map((x: Row) => x.id)).toEqual([ids[1]])
    await rpc(db, READER, `select public.knowledge_feedback($1, true, 'Rất dễ hiểu')`, [ids[1]])
    await rpc(db, READER, `select public.knowledge_track($1, 'SHARE')`, [ids[1]])
    await rpc(db, READER, `select public.knowledge_track($1, 'SHARE')`, [ids[1]])
    await rpc(db, READER, `select public.knowledge_track($1, 'CTA')`, [ids[1]])
    expect((await db.query<Row>(`select saves, shares, cta_clicks, helpful_yes from public.content_articles where id = $1`, [ids[1]])).rows[0])
      .toEqual({ saves: 1, shares: 1, cta_clicks: 1, helpful_yes: 1 })
    const stats = await rpc<Row>(db, EDITOR, `select public.cms_stats(7) as r`)
    expect(Number(stats.totals.reads)).toBeGreaterThanOrEqual(4)
    expect(stats.days).toHaveLength(7)
    expect(Number((await rpc<Row>(db, ADM, `select public.admin_inbox() as r`)).content)).toBe(1)             // bài giáo án đang chờ duyệt lại
  })

  it('kho ảnh content-media: chỉ ban nội dung tải vào thư mục của mình', async () => {
    await db.exec(`alter table storage.objects enable row level security; grant select, insert on storage.objects to authenticated;`)
    const put = (uid: string, name: string) => asUser(db, uid, '/storage/v1/object', `insert into storage.objects (bucket_id, name) values ('content-media', $1)`, [name])
    expect(await fails(put(WRITER, `${WRITER}/bia.jpg`))).toBe('OK')
    expect(await fails(put(WRITER, `${EDITOR}/bia.jpg`))).toMatch(/row-level security|policy/i)
    expect(await fails(put(READER, `${READER}/bia.jpg`))).toMatch(/row-level security|policy/i)
  })
})
