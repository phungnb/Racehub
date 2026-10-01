import { describe, it, expect, vi, beforeEach } from 'vitest'

// Giả lập supabase: mỗi lượt from(...) ghi lại chuỗi lệnh, trả kết quả theo hàng đợi
type Res = { data: unknown; error: unknown }
const calls: { table: string; ops: unknown[][] }[] = []
let queue: Res[] = []
function builder(table: string) {
  const rec = { table, ops: [] as unknown[][] }
  calls.push(rec)
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'lt', 'order', 'limit']) b[m] = (...a: unknown[]) => { rec.ops.push([m, ...a]); return b }
  b.then = (ok: (r: Res) => unknown) => Promise.resolve(queue.shift() as Res).then(ok)
  return b
}
vi.mock('@/shared/lib/supabase', () => ({ supabase: { from: (t: string) => builder(t) } }))
const { listPosts } = await import('./postsApi')

const post = (id: string, mine?: { post_id: string }[]) => ({ id, author: [{ id: 'a', display_name: 'A', level: 1, avatar_url: null }], image_paths: null, meta: null, ...(mine ? { mine } : {}) })

describe('bảng tin CLB: lượt thích của mình lấy kèm trong một lượt tải', () => {
  beforeEach(() => { calls.length = 0; queue = [] })

  it('một lượt gọi, lọc lượt thích theo người xem', async () => {
    queue = [{ data: [post('p1', [{ post_id: 'p1' }]), post('p2', [])], error: null }]
    const posts = await listPosts('c1', 'u1')
    expect(calls).toHaveLength(1)
    expect(calls[0].ops).toContainEqual(['eq', 'mine.user_id', 'u1'])
    expect(posts.map((p) => p.reacted)).toEqual([true, false])
    expect(posts[0]).not.toHaveProperty('mine')
    expect(posts[0].author?.id).toBe('a')
  })

  it('máy chủ không nhận truy vấn gộp → quay về cách cũ (2 lượt), kết quả như nhau', async () => {
    queue = [
      { data: null, error: { code: 'PGRST200', message: 'relationship' } },
      { data: [post('p1'), post('p2')], error: null },
      { data: [{ post_id: 'p2' }], error: null },
    ]
    const posts = await listPosts('c1', 'u1')
    expect(calls.map((c) => c.table)).toEqual(['club_posts', 'club_posts', 'club_post_reactions'])
    expect(calls[1].ops).not.toContainEqual(['eq', 'mine.user_id', 'u1'])
    expect(posts.map((p) => p.reacted)).toEqual([false, true])
  })

  it('lỗi khác (vd. mất mạng) vẫn báo lỗi như trước', async () => {
    queue = [{ data: null, error: { code: '08006', message: 'network' } }]
    await expect(listPosts('c1', 'u1')).rejects.toMatchObject({ code: '08006' })
  })
})
