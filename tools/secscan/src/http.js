// Lớp HTTP dùng chung. TẤT CẢ yêu cầu đều là GET (read-only). Không có hàm POST/
// PATCH/DELETE trong công cụ này — đó là bảo đảm "không phá" của secscan.
const TIMEOUT_MS = 10000

export async function get(url, headers = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal, redirect: 'follow' })
    const text = await res.text()
    return { status: res.status, headers: res.headers, text }
  } catch (e) {
    return { status: 0, headers: new Headers(), text: '', error: String(e?.message || e) }
  } finally {
    clearTimeout(t)
  }
}

export function parseJson(text) {
  try { return JSON.parse(text) } catch { return null }
}
