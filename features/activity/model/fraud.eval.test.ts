import { describe, it, expect } from 'vitest'
import { analyzeRun } from './fraud'
import { buildCorpus, type CorpusLabel } from './fraudCorpus'

// Đo tỷ lệ phân loại sai trên bộ dữ liệu có nhãn (mô phỏng). In bảng kết quả để đối chiếu khi đổi quy tắc / ngưỡng.
describe('đánh giá bộ chống gian lận trên bộ dữ liệu có nhãn', () => {
  const corpus = buildCorpus(12)
  const rows = new Map<string, { label: CorpusLabel; n: number; review: number; codes: Map<string, number> }>()
  for (const run of corpus) {
    const r = analyzeRun(run.summary, run.streams, run.history)
    const row = rows.get(run.kind) ?? { label: run.label, n: 0, review: 0, codes: new Map() }
    row.n++
    if (r.verdict === 'REVIEW') {
      row.review++
      for (const f of r.flags) if (f.tier !== 'NOTE') row.codes.set(`${f.code}:${f.tier}`, (row.codes.get(`${f.code}:${f.tier}`) ?? 0) + 1)
    }
    rows.set(run.kind, row)
  }
  const by = (labels: CorpusLabel[]) => [...rows.values()].filter((x) => labels.includes(x.label))
  const rate = (xs: { n: number; review: number }[]) => xs.reduce((s, x) => s + x.review, 0) / Math.max(1, xs.reduce((s, x) => s + x.n, 0))

  it('in bảng kết quả', () => {
    console.table([...rows.entries()].map(([kind, x]) => ({ kind, label: x.label, n: x.n, chuyenDuyet: x.review,
      rate: `${Math.round((x.review / x.n) * 100)}%`, why: [...x.codes.entries()].map(([k, v]) => `${k}×${v}`).join(' ') })))
    expect(rows.size).toBeGreaterThan(10)
  })
  it('bài thật phong trào: 0% bị giữ nhầm', () => { expect(rate(by(['REAL']))).toBe(0) })
  it('bài thật có lỗi GPS: 0% bị giữ nhầm', () => { expect(rate(by(['GPS_ERROR']))).toBe(0) })
  it('gian lận rõ ràng: phát hiện ≥ 95%', () => { expect(rate(by(['CHEAT']))).toBeGreaterThanOrEqual(0.95) })
})
