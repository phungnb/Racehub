import { fmtDuration, fmtPace, type ExportRow, type summarize } from '../model/insights'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const km1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString('vi-VN')

/** Mở bản báo cáo in được (khổ A4, nền trắng) trong cửa sổ mới rồi gọi hộp thoại in → người dùng chọn "Lưu PDF" */
export function printReport({ name, range, rows, summary }: {
  name: string; range: string; rows: ExportRow[]; summary: ReturnType<typeof summarize>
}): boolean {
  const w = window.open('', '_blank')
  if (!w) return false
  const s = summary
  const months = s.months.map((m) => `<tr><td>${m.month.slice(5)}/${m.month.slice(0, 4)}</td><td>${m.runs}</td><td>${km1(m.km)}</td><td>${fmtDuration(m.moving_s)}</td><td>${m.km ? fmtPace(m.moving_s / m.km) : '—'}</td></tr>`).join('')
  const runs = rows.map((r) => `<tr><td>${new Date(r.started_at).toLocaleDateString('vi-VN')}</td><td>${esc(r.title ?? '')}</td><td>${km1(r.km)}</td><td>${fmtDuration(r.moving_s)}</td><td>${r.km ? fmtPace(r.moving_s / r.km) : '—'}</td><td>${r.avg_hr ?? ''}</td></tr>`).join('')
  w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Báo cáo chạy bộ — ${esc(name)}</title>
<style>
  body{font:13px/1.5 system-ui,sans-serif;color:#111;margin:24px}
  h1{font-size:20px;margin:0}h2{font-size:15px;margin:20px 0 6px}
  .muted{color:#555}.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}
  .tile{border:1px solid #ddd;border-radius:8px;padding:8px}.tile b{display:block;font-size:18px}
  table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:4px 6px;border-bottom:1px solid #eee}
  th{font-weight:600;color:#444}td:nth-child(n+3),th:nth-child(n+3){text-align:right}
  @page{size:A4;margin:14mm}
</style></head><body>
<h1>Báo cáo chạy bộ — ${esc(name)}</h1>
<p class="muted">${esc(range)} · xuất từ RaceHub ngày ${new Date().toLocaleDateString('vi-VN')}</p>
<div class="tiles">
  <div class="tile">Tổng km<b>${km1(s.km)}</b></div><div class="tile">Số buổi<b>${s.runs}</b></div>
  <div class="tile">Thời gian chạy<b>${fmtDuration(s.moving_s)}</b></div><div class="tile">Pace TB<b>${s.km ? fmtPace(s.pace) + '/km' : '—'}</b></div>
</div>
<p class="muted">Bài dài nhất: ${km1(s.longest)} km</p>
<h2>Theo tháng</h2>
<table><thead><tr><th>Tháng</th><th>Buổi</th><th>Km</th><th>Thời gian</th><th>Pace</th></tr></thead><tbody>${months}</tbody></table>
<h2>Chi tiết bài chạy</h2>
<table><thead><tr><th>Ngày</th><th>Bài</th><th>Km</th><th>Thời gian</th><th>Pace</th><th>Nhịp tim TB</th></tr></thead><tbody>${runs}</tbody></table>
<script>window.onload=function(){window.print()}</script>
</body></html>`)
  w.document.close()
  return true
}
