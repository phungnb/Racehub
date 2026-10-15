import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 016500: tin kiến thức tự quét vào hàng chờ biên tập, không tự đăng
const USR = '00000000-0000-0000-0000-000000016501'

describe('Quét tin kiến thức (016500)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed: async (d) => {
      await d.exec(`insert into auth.users (id, email) values ('${USR}', 'u165@x.vn');
        insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${USR}', 'Runner', 0, 0, 1, now()) on conflict do nothing;`)
    } })
  }, 240_000)

  const ingest = async (p: object) => (await db.query<{ id: string | null }>(`select public.knowledge_scan_ingest($1::jsonb) as id`, [JSON.stringify(p)])).rows[0].id
  const base = { title: 'Cách chạy 5K đầu tiên', summary: 'Tóm tắt ngắn.', category_id: 'BEGINNER', source_url: 'https://bao.vn/a', source_name: 'Báo A', tags: ['5K', 'Mới chạy'] }

  it('chỉ service_role gọi được; người dùng thường bị từ chối', async () => {
    await expect(asUser(db, USR, '/rest', `select public.knowledge_scan_ingest('{}'::jsonb)`)).rejects.toThrow(/permission denied/)
    await expect(db.query(`select public.knowledge_scan_ingest('{}'::jsonb)`).then(() => 'ok', () => 'err')).resolves.toBeDefined()
  })

  it('tạo bài NEWS ở REVIEW kèm link nguồn; trùng link thì bỏ qua; người đọc không thấy', async () => {
    await db.exec('set role service_role')
    const id = await ingest(base)
    expect(id).toBeTruthy()
    expect(await ingest({ ...base, title: 'Tiêu đề khác hẳn' })).toBeNull()
    expect(await ingest({ ...base, source_url: 'https://BAO.vn/A' })).toBeNull()
    expect(await ingest({ ...base, source_url: 'javascript:alert(1)' })).toBeNull()
    expect(await ingest({ ...base, source_url: 'https://bao.vn/b', title: 'ab' })).toBeNull()
    await db.exec('reset role')
    const r = (await db.query<{ status: string; content_type: string; body: string; needs_expert_review: boolean }>(
      `select status, content_type, body, needs_expert_review from public.content_articles where id = $1`, [id])).rows[0]
    expect(r.status).toBe('REVIEW')
    expect(r.content_type).toBe('NEWS')
    expect(r.body).toContain('https://bao.vn/a')
    expect(r.needs_expert_review).toBe(false)
    const list = await asUser<{ r: unknown }>(db, USR, '/rest', `select public.knowledge_list('{}'::jsonb) as r`)
    expect(JSON.stringify(list.rows[0].r)).not.toContain('Cách chạy 5K đầu tiên')
  })

  it('chuyên mục sức khoẻ bắt buộc duyệt chuyên môn; chuyên mục lạ rơi về RACES', async () => {
    await db.exec('set role service_role')
    const a = await ingest({ ...base, source_url: 'https://bao.vn/dd', title: 'Ăn gì trước khi chạy', category_id: 'NUTRITION' })
    const b = await ingest({ ...base, source_url: 'https://bao.vn/zz', title: 'Tin khác bất kỳ', category_id: 'NOPE' })
    await db.exec('reset role')
    const rows = (await db.query<{ id: string; needs_expert_review: boolean; category_id: string }>(
      `select id, needs_expert_review, category_id from public.content_articles where id in ($1, $2)`, [a, b])).rows
    expect(rows.find((x) => x.id === a)?.needs_expert_review).toBe(true)
    expect(rows.find((x) => x.id === b)?.category_id).toBe('RACES')
  })

  it('bài đầy đủ: lưu ARTICLE với toàn văn + nguồn; body quá ngắn thì rơi về tóm tắt', async () => {
    const full = 'Đoạn nội dung đầy đủ của bài. '.repeat(20)
    await db.exec('set role service_role')
    const a = await ingest({ ...base, source_url: 'https://bao.vn/full', title: 'Bài viết đầy đủ về chạy bộ', body: full })
    const b = await ingest({ ...base, source_url: 'https://bao.vn/short', title: 'Bài có body quá ngắn', body: 'ngắn' })
    await db.exec('reset role')
    const rows = (await db.query<{ id: string; content_type: string; body: string; status: string }>(
      `select id, content_type, body, status from public.content_articles where id in ($1, $2)`, [a, b])).rows
    const ra = rows.find((x) => x.id === a)!
    const rb = rows.find((x) => x.id === b)!
    expect([ra.content_type, ra.status]).toEqual(['ARTICLE', 'REVIEW'])
    expect(ra.body).toContain('Đoạn nội dung đầy đủ của bài.')
    expect(ra.body).toContain('https://bao.vn/full')
    expect(rb.content_type).toBe('NEWS')
    expect(rb.body).not.toContain('ngắn\n')
  })
})
