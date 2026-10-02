// LỖI phụ trợ: khóa service_role lọt vào mã front-end.
//
// Khóa anon của Supabase NẰM CÔNG KHAI trong bundle là bình thường (nó vô hại khi
// RLS đúng). Nhưng khóa service_role thì BỎ QUA MỌI RLS — lọt ra ngoài là tai họa.
// Cả hai đều là JWT; phân biệt bằng claim "role" sau khi giải mã phần payload.
//
// Read-only: chỉ tải HTML trang chủ và các file .js nó tham chiếu.
import { get } from '../http.js'

const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g

function decodeRole(jwt) {
  try {
    const payload = jwt.split('.')[1]
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return json.role || null
  } catch { return null }
}

function extractScripts(html, base) {
  const srcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1])
  return srcs.map((s) => {
    try { return new URL(s, base).href } catch { return null }
  }).filter(Boolean)
}

export async function checkKeyInBundle({ target }) {
  const findings = []
  const home = await get(target)
  if (home.status === 0) {
    return { ok: false, note: `Không tải được ${target}: ${home.error}`, findings }
  }

  const sources = [{ url: target, body: home.text }]
  // Quét tối đa 20 file JS đầu để tránh tải quá nhiều.
  for (const js of extractScripts(home.text, target).slice(0, 20)) {
    const r = await get(js)
    if (r.status === 200) sources.push({ url: js, body: r.text })
  }

  const seen = new Set()
  for (const { url, body } of sources) {
    for (const jwt of body.match(JWT_RE) || []) {
      if (seen.has(jwt)) continue
      seen.add(jwt)
      const role = decodeRole(jwt)
      if (role === 'service_role') {
        findings.push({
          severity: 'critical',
          title: 'Khóa service_role lộ trong mã front-end',
          detail: `Tìm thấy JWT role=service_role tại ${url}. Khóa này bỏ qua toàn bộ RLS.`,
          fix: 'Xoay (rotate) khóa ngay trong Supabase, gỡ khỏi mã client, chỉ dùng ở phía máy chủ.',
        })
      }
    }
  }
  if (!findings.length) {
    return { ok: true, note: 'Không thấy khóa service_role trong front-end (khóa anon lộ là bình thường).', findings }
  }
  return { ok: false, findings }
}
