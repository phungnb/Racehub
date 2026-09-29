import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 010400: bình luận có Thích và Trả lời
const [OWNER, A, B, OUT] = [1, 2, 3, 4].map((n) => `00000000-0000-0000-0000-0000001040${String(n).padStart(2, '0')}`)
type C = { id: string; parent_id: string | null; like_count: number; liked: boolean; can_delete: boolean; body: string }

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o104@x.vn'), ('${A}', 'a104@x.vn'), ('${B}', 'b104@x.vn'), ('${OUT}', 'x104@x.vn');
    insert into public.profiles (id, display_name) values ('${OWNER}', 'Chủ nhiệm'), ('${A}', 'An'), ('${B}', 'Bình'), ('${OUT}', 'Ngoài') on conflict do nothing;
  `)
}
const rpc = async <T,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('bình luận: thích + trả lời (010400)', () => {
  let db: PGlite
  let post: string
  const thread = (uid: string) => rpc<C[]>(db, uid, `select public.club_post_comment_thread($1) as r`, [post])
  const notes = async (uid: string, kind: string) => Number((await db.query<{ n: string }>(
    `select count(*) n from public.notifications where user_id = $1 and kind = $2`, [uid, kind])).rows[0].n)

  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    const c = await rpc<{ id: string; invite_code: string }>(db, OWNER, `select public.create_club('Hồ Tây', 'Chạy sáng') as r`)
    await db.query(`update public.clubs set join_policy = 'OPEN' where id = $1`, [c.id])
    for (const u of [A, B]) await asUser(db, u, '/rpc', `select public.join_club_by_code($1)`, [c.invite_code])
    post = (await rpc<{ id: string }>(db, OWNER, `select to_jsonb(public.create_club_post($1, 'Chạy xong 10 km!')) as r`, [c.id])).id
  }, 240_000)

  it('trả lời hiện dưới bình luận gốc; trả lời một câu trả lời vẫn về bình luận gốc; người được trả lời nhận thông báo', async () => {
    const root = (await rpc<{ id: string }>(db, A, `select to_jsonb(public.add_post_comment($1, 'Chúc mừng anh', null::uuid)) as r`, [post])).id
    const r1 = (await rpc<{ id: string }>(db, OWNER, `select to_jsonb(public.add_post_comment($1, 'Cảm ơn em', $2::uuid)) as r`, [post, root])).id
    await rpc(db, B, `select to_jsonb(public.add_post_comment($1, '@Chủ nhiệm đỉnh quá', $2::uuid)) as r`, [post, r1])
    const t = await thread(A)
    expect(t).toHaveLength(3)
    expect(t.filter((c) => c.parent_id === root)).toHaveLength(2)
    expect(await notes(A, 'COMMENT_REPLY')).toBe(1)        // chủ nhiệm trả lời An
    expect(await notes(OWNER, 'COMMENT_REPLY')).toBe(1)    // Bình trả lời chủ nhiệm (hiển thị dưới gốc của An)
    expect(await fails(rpc(db, A, `select to_jsonb(public.add_post_comment($1, 'x', $2::uuid)) as r`, [post, '00000000-0000-0000-0000-000000000000']))).toContain('COMMENT_NOT_FOUND')
  })

  it('thích / bỏ thích: đếm đúng, biết mình đã thích; thông báo tối đa 1 lần / ngày; người ngoài CLB không thích được', async () => {
    const c = (await thread(OWNER)).find((x) => x.body === 'Chúc mừng anh')!
    expect(await rpc(db, OWNER, `select public.toggle_post_comment_like($1) as r`, [c.id])).toEqual({ liked: true, count: 1 })
    expect(await rpc(db, B, `select public.toggle_post_comment_like($1) as r`, [c.id])).toEqual({ liked: true, count: 2 })
    expect(await rpc(db, OWNER, `select public.toggle_post_comment_like($1) as r`, [c.id])).toEqual({ liked: false, count: 1 })
    await rpc(db, OWNER, `select public.toggle_post_comment_like($1) as r`, [c.id])
    expect(await notes(A, 'COMMENT_LIKE')).toBe(2)          // chủ nhiệm (một lần dù bấm 2 lần) + Bình
    const mine = (await thread(OWNER)).find((x) => x.id === c.id)!
    expect(mine).toMatchObject({ like_count: 2, liked: true })
    expect((await thread(A)).find((x) => x.id === c.id)).toMatchObject({ liked: false })
    expect(await fails(rpc(db, OUT, `select public.toggle_post_comment_like($1) as r`, [c.id]))).toContain('NOT_A_MEMBER')
  })

  it('quyền xóa: người viết và ban quản trị; thành viên khác không', async () => {
    const t = await thread(B)
    expect(t.find((x) => x.body === 'Chúc mừng anh')!.can_delete).toBe(false)
    expect(t.find((x) => x.body.startsWith('@Chủ nhiệm'))!.can_delete).toBe(true)
    expect((await thread(OWNER)).every((x) => x.can_delete)).toBe(true)
    expect(await fails(thread(OUT))).toContain('NOT_A_MEMBER')
  })
})
