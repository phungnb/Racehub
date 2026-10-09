import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 015000: hộp thư góp ý (bong bóng nổi)
const id = (n: number) => `00000000-0000-0000-0000-0000000150${String(n).padStart(2, '0')}`
const [ADM, U1, U2] = [1, 2, 3].map(id)

async function seed(db: PGlite) {
  const users = [ADM, U1, U2]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'f${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'F${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const send = (db: PGlite, uid: string, kind: string, rating: number | null, body: string | null) =>
  rpc(db, uid, `select public.submit_feedback($1, $2, $3, 'web', '/me')::text as r`, [kind, rating, body])

describe('hộp thư góp ý (015000)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, seed, until: '20261001015000' })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
  }, 240_000)

  it('kiểm tra đầu vào và giới hạn 5 góp ý / 24 giờ', async () => {
    expect(await fails(send(db, U1, 'XYZ', 5, null))).toContain('INVALID_FEEDBACK_KIND')
    expect(await fails(send(db, U1, 'IDEA', 9, null))).toContain('INVALID_FEEDBACK_RATING')
    expect(await fails(send(db, U1, 'IDEA', null, ' a '))).toContain('FEEDBACK_EMPTY')
    expect(await fails(send(db, U1, 'IDEA', null, 'x'.repeat(1001)))).toContain('FEEDBACK_TOO_LONG')
    await send(db, U1, 'LOVE', 5, null)
    for (let i = 0; i < 4; i++) await send(db, U1, 'IDEA', null, `Ý kiến số ${i}`)
    expect(await fails(send(db, U1, 'IDEA', null, 'Thêm một ý nữa'))).toContain('FEEDBACK_RATE_LIMIT')
  })

  it('chỉ admin xem và xử lý; số liệu tóm tắt đúng', async () => {
    await send(db, U2, 'BUG', 3, 'Nút Chạy bị lag')
    expect(await fails(rpc(db, U1, `select public.admin_feedback_list('NEW') as r`))).toContain('FORBIDDEN')
    const l = await rpc<Row>(db, ADM, `select public.admin_feedback_list('NEW') as r`)
    expect(l.items.length).toBeGreaterThanOrEqual(6)
    expect(l.new_count).toBe(l.items.length)
    const bug = l.items.find((x: Row) => x.kind === 'BUG')
    expect(bug).toMatchObject({ name: 'F2', email: 'f2@x.vn', rating: 3, body: 'Nút Chạy bị lag', platform: 'web', page: '/me' })
    expect(await fails(rpc(db, U2, `select public.admin_feedback_set_status($1, 'DONE')::text as r`, [bug.id]))).toContain('FORBIDDEN')
    await rpc(db, ADM, `select public.admin_feedback_set_status($1, 'DONE', 'Đã sửa')::text as r`, [bug.id])
    const done = await rpc<Row>(db, ADM, `select public.admin_feedback_list('DONE') as r`)
    expect(done.items).toHaveLength(1)
    expect(done.items[0]).toMatchObject({ status: 'DONE', admin_note: 'Đã sửa', handled_by: 'F0' })
    await rpc(db, ADM, `select public.admin_feedback_set_status($1, 'NEW')::text as r`, [bug.id])
    expect((await rpc<Row>(db, ADM, `select public.admin_feedback_list('DONE') as r`)).items).toHaveLength(0)
    expect(await fails(rpc(db, ADM, `select public.admin_feedback_set_status($1, 'DONE')::text as r`, [id(99)]))).toContain('FEEDBACK_NOT_FOUND')
  })
})
