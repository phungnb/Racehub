import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { candidateKey, extractRaces, htmlToText, normalizeExtracted } = await import('./race-extract')

describe('htmlToText', () => {
  it('bỏ script/thẻ, giữ link tuyệt đối', () => {
    const t = htmlToText('<head><title>x</title></head><script>evil()</script><p>Giải <a href="/dk">Đăng ký</a></p>', 'https://a.vn/lich')
    expect(t).not.toContain('evil')
    expect(t).toContain('Đăng ký (https://a.vn/dk)')
  })
})

describe('normalizeExtracted', () => {
  it('chặn dữ liệu sai kiểu / ngày sai / link không phải http', () => {
    const r = normalizeExtracted({ races: [
      { title: ' Dalat Marathon ', race_date: '2027-03-01', end_date: '01/03', location: 'Đà Lạt', province: 'Lâm Đồng', distances: ['21K', 5, ''], organizer: 'X', reg_url: 'javascript:1', description: 'ok' },
      { title: '', race_date: '2027-01-01' },
    ] })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ title: 'Dalat Marathon', race_date: '2027-03-01', end_date: '', reg_url: '', distances: ['21K'] })
  })
  it('đầu vào rác → rỗng', () => { expect(normalizeExtracted(null)).toEqual([]); expect(normalizeExtracted({ races: 'x' })).toEqual([]) })
})

describe('candidateKey', () => {
  it('trang#tên-ngày, bỏ dấu', () => {
    expect(candidateKey('https://a.vn/lich#top', { title: 'Đà Nẵng Marathon 2027', race_date: '2027-04-10' })).toBe('https://a.vn/lich#da-nang-marathon-2027-2027-04-10')
  })
})

describe('extractRaces (Gemini)', () => {
  const ok = (text: string, finishReason = 'STOP') => new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }] }), { status: 200 })
  const run = async (res: Response) => {
    vi.stubEnv('GEMINI_API_KEY', 'k')
    const f = vi.fn().mockResolvedValue(res); vi.stubGlobal('fetch', f)
    return { f, p: extractRaces('<p>x</p>', 'https://a.vn/', '2026-10-15') }
  }
  it('đọc JSON từ candidates', async () => {
    const { f, p } = await run(ok(JSON.stringify({ races: [{ title: 'Hue Run', race_date: '2027-02-01' }] })))
    expect((await p).races[0]).toMatchObject({ title: 'Hue Run', race_date: '2027-02-01' })
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'x-goog-api-key': 'k' })
  })
  it('429 → AI_LIMIT, 403 → AI_KEY, bị cắt → AI_FAILED', async () => {
    await expect((await run(new Response('{}', { status: 429 }))).p).rejects.toMatchObject({ code: 'AI_LIMIT' })
    await expect((await run(new Response('{}', { status: 403 }))).p).rejects.toMatchObject({ code: 'AI_KEY' })
    await expect((await run(ok('{"races":[', 'MAX_TOKENS'))).p).rejects.toMatchObject({ code: 'AI_FAILED' })
  })
})
