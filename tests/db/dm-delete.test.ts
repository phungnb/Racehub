import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 014700: xóa tin nhắn kiểu Zalo (thu hồi 24 giờ, xóa phía tôi, xóa cuộc trò chuyện)
const [A, B, C] = [1, 2, 3].map((n) => `00000000-0000-0000-0000-0000001470${String(n).padStart(2, '0')}`)
type Row = Record<string, any>
async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${A}', 'a147@x.vn'), ('${B}', 'b147@x.vn'), ('${C}', 'c147@x.vn');
    insert into public.profiles (id, display_name) values ('${A}', 'An'), ('${B}', 'Bình'), ('${C}', 'Chi') on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('xóa tin nhắn 1-1 (014700)', () => {
  let db: PGlite
  const send = (from: string, to: string, body: string) => rpc<Row>(db, from, `select public.send_direct_message($1, $2) as r`, [to, body])
  const thread = (uid: string, other: string) => rpc<Row>(db, uid, `select public.direct_thread($1) as r`, [other])
  const inbox = (uid: string) => rpc<Row[]>(db, uid, `select public.direct_inbox() as r`)
  const unread = (uid: string) => rpc<number>(db, uid, `select public.direct_unread_count() as r`)

  beforeAll(async () => {
    db = await createDb({ withMigrations: true, seed, until: '20261001014700' })
    await rpc(db, B, `select public.follow_runner($1) as r`, [A])
    await rpc(db, A, `select public.follow_runner($1) as r`, [B])
  }, 300_000)

  it('thu hồi: chỉ tin của mình, trong 24 giờ; quá hạn bị từ chối', async () => {
    const m1 = await send(A, B, 'Tin cũ')
    const m2 = await send(A, B, 'Tin mới')
    expect(await fails(rpc(db, B, `select public.delete_direct_message($1) as r`, [m2.id]))).toContain('NOT_AUTHOR')
    await db.query(`update public.direct_messages set created_at = now() - interval '25 hours' where id = $1`, [m1.id])
    expect(await fails(rpc(db, A, `select public.delete_direct_message($1) as r`, [m1.id]))).toContain('RECALL_EXPIRED')
    await rpc(db, A, `select public.delete_direct_message($1) as r`, [m2.id])
    expect((await thread(B, A)).messages.map((x: Row) => [x.body, x.deleted])).toEqual([['Tin cũ', false], [null, true]])
  })

  it('xóa ở phía tôi: chỉ ẩn với mình, cho cả tin người khác; người ngoài không ẩn được', async () => {
    const m = await send(B, A, 'Chạy sáng mai nhé')
    expect(await fails(rpc(db, C, `select public.hide_direct_message($1) as r`, [m.id]))).toContain('NOT_FOUND')
    expect(await unread(A)).toBe(1)
    await rpc(db, A, `select public.hide_direct_message($1) as r`, [m.id])
    await rpc(db, A, `select public.hide_direct_message($1) as r`, [m.id])   // lặp lại vẫn ổn
    expect((await thread(A, B)).messages.map((x: Row) => x.id)).not.toContain(m.id)
    expect((await thread(B, A)).messages.map((x: Row) => x.id)).toContain(m.id)
    expect(await unread(A)).toBe(0)
    expect(await fails(asUser(db, A, '/rest', `select * from public.direct_message_hidden`))).not.toBe('OK')
  })

  it('xóa cuộc trò chuyện: ẩn khỏi hộp thư phía mình, người kia giữ nguyên, tin mới hiện lại không kèm tin cũ', async () => {
    expect(await inbox(A)).toHaveLength(1)
    await rpc(db, A, `select public.clear_direct_thread($1) as r`, [B])
    expect(await inbox(A)).toEqual([])
    expect((await thread(A, B)).messages).toEqual([])
    expect(await inbox(B)).toHaveLength(1)
    expect((await thread(B, A)).messages.length).toBeGreaterThanOrEqual(3)
    await send(B, A, 'Còn đó không?')
    const inb = await inbox(A)
    expect(inb).toHaveLength(1)
    expect(inb[0]).toMatchObject({ unread: 1, last: { body: 'Còn đó không?' } })
    expect((await thread(A, B)).messages.map((x: Row) => x.body)).toEqual(['Còn đó không?'])
  })
})
