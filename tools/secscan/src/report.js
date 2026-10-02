// Xuất báo cáo xếp theo mức nghiêm trọng. Đây là thứ giao cho chủ app (hoặc khách
// đã cho phép) để vá — không in dữ liệu moi được, chỉ in SỐ cột lộ và cách khắc phục.
const ORDER = { critical: 0, high: 1, medium: 2, low: 3 }
const LABEL = { critical: 'NGHIÊM TRỌNG', high: 'CAO', medium: 'TRUNG BÌNH', low: 'THẤP' }

export function buildReport({ auth, startedAt, results }) {
  const all = []
  for (const [check, res] of Object.entries(results)) {
    for (const f of res.findings || []) all.push({ check, ...f })
  }
  all.sort((a, b) => (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9))

  const counts = all.reduce((m, f) => ((m[f.severity] = (m[f.severity] || 0) + 1), m), {})
  const lines = []
  lines.push('='.repeat(64))
  lines.push('secscan — BÁO CÁO RÀ SOÁT CẤU HÌNH AN TOÀN')
  lines.push('='.repeat(64))
  lines.push(`Mục tiêu    : ${auth.target}`)
  lines.push(`Được phép bởi: ${auth.authorizedBy}`)
  lines.push(`Thời điểm   : ${startedAt}`)
  lines.push('Phạm vi     : read-only; các lớp lỗi RaceHub đã khắc phục')
  lines.push('')
  const summary = ['critical', 'high', 'medium', 'low']
    .map((s) => `${LABEL[s]}: ${counts[s] || 0}`).join('  |  ')
  lines.push(`Tổng phát hiện: ${all.length}   (${summary})`)
  lines.push('')

  for (const [check, res] of Object.entries(results)) {
    if (res.note) lines.push(`• [${check}] ${res.note}`)
  }
  if (all.length) lines.push('')

  all.forEach((f, i) => {
    lines.push(`[${i + 1}] ${LABEL[f.severity] || f.severity} — ${f.title}`)
    if (f.detail) lines.push(`    Chi tiết: ${f.detail}`)
    if (f.fix) lines.push(`    Cách vá : ${f.fix}`)
    lines.push('')
  })

  if (!all.length) lines.push('Không phát hiện lỗi thuộc phạm vi kiểm tra. (Không thay cho rà soát thủ công.)')
  return { text: lines.join('\n'), counts, total: all.length }
}
