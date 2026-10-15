import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const fetchHtml = vi.fn()
vi.mock('./safe-fetch', () => ({ fetchHtml: (...a: unknown[]) => fetchHtml(...a), robotsAllows: async () => true, FetchError: class extends Error { constructor(public code: string) { super(code) } } }))
vi.mock('./web-search', () => ({ searchWeb: vi.fn(), SearchError: class extends Error {} }))
const callAi = vi.fn()
vi.mock('./race-extract', () => ({
  ExtractError: class extends Error { constructor(public code: string) { super(code) } },
  callAi: (...a: unknown[]) => callAi(...a), extractionEnabled: () => true, htmlToText: (h: string) => h,
}))
const { scanKnowledgeSource } = await import('./knowledge-scan')

const BODY = 'Tuần 1: chạy nhẹ 5 km pace 7:00. '.repeat(15)
const art = (o: Record<string, unknown>) => ({ title: 'Giáo án 10K cho người mới', summary: 'Tóm tắt.', category_id: 'TRAINING', tags: [], source_name: 'Báo A', url: '', body: '', ...o })
const html = (u: URL | string) => ({ html: 'x', url: new URL(String(u)) })

function makeDb() {
  const rpc = vi.fn(async () => ({ data: 'id', error: null }))
  const upd = { eq: vi.fn(async () => ({})) }
  const db = { rpc, from: () => ({ update: () => upd }) }
  return { db: db as never, rpc }
}
const ingested = (rpc: ReturnType<typeof vi.fn>) => rpc.mock.calls.map((c) => (c as unknown as [string, { p: { source_url: string; body?: string } }])[1].p)

beforeEach(() => { fetchHtml.mockReset(); callAi.mockReset(); fetchHtml.mockImplementation(async (u: string) => html(u)) })

describe('scanKnowledgeSource (chế độ đầy đủ)', () => {
  const src = { id: 's1', kind: 'PAGE', url: 'https://bao.vn/chuyen-muc', query: null, category_id: null, scan_mode: 'FULL' }

  it('trang danh sách: mở từng bài con, lưu toàn văn thay vì đoạn dẫn', async () => {
    callAi.mockImplementation(async (_s: string, user: string) => JSON.stringify({ articles: user.includes('/chuyen-muc') && !user.includes('/bai-')
      ? [art({ title: 'Giáo án 10K cho người mới', url: '/bai-1' }), art({ title: 'Giáo án 21K cho người mới', url: '/bai-2' })]
      : [art({ body: BODY })] }))
    const { db, rpc } = makeDb()
    const r = await scanKnowledgeSource(db, src, Date.now() + 60_000)
    const got = ingested(rpc as never)
    expect(r.error).toBeNull()
    expect(got.map((g) => g.source_url).sort()).toEqual(['https://bao.vn/bai-1', 'https://bao.vn/bai-2'])
    expect(got.every((g) => g.body && g.body.length > 300)).toBe(true)
  })

  it('bài con không mở được: vẫn lưu dạng tóm tắt (không mất tin)', async () => {
    fetchHtml.mockImplementation(async (u: string) => { if (String(u).includes('/bai-')) throw new Error('boom'); return html(u) })
    callAi.mockResolvedValue(JSON.stringify({ articles: [art({ url: '/bai-1' })] }))
    const { db, rpc } = makeDb()
    await scanKnowledgeSource(db, src, Date.now() + 60_000)
    const got = ingested(rpc as never)
    expect(got).toHaveLength(1)
    expect(got[0].source_url).toBe('https://bao.vn/bai-1')
    expect(got[0].body).toBeUndefined()
  })

  it('xin đủ token cho bài dài (16000) ở chế độ đầy đủ', async () => {
    callAi.mockResolvedValue(JSON.stringify({ articles: [] }))
    const { db } = makeDb()
    await scanKnowledgeSource(db, src, Date.now() + 60_000)
    expect(callAi.mock.calls[0][3]).toBe(16000)
  })
})
