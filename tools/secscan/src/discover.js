// Tự dò địa chỉ Supabase và khóa anon TỪ CHÍNH MÃ FRONT-END của trang — đúng cách
// các công cụ thật làm, nên người dùng chỉ cần đưa URL. Khóa anon là khóa công khai,
// nằm sẵn trong bundle JS (ai mở F12 cũng thấy), nên việc đọc nó không lộ thêm gì.
//
// Read-only: chỉ tải HTML trang chủ và các file .js nó tham chiếu.
import { get } from './http.js'

const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
const SUPABASE_URL_RE = /https:\/\/[a-z0-9-]+\.supabase\.(?:co|in|net)/gi

function role(jwt) {
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).role || null }
  catch { return null }
}

function extractScripts(html, base) {
  return [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
    .map((m) => { try { return new URL(m[1], base).href } catch { return null } })
    .filter(Boolean)
}

/**
 * Trả về { supabaseUrl, anonKey, serviceRoleKey, sources } — bất cứ thứ gì dò được.
 * serviceRoleKey khác null nghĩa là CÓ lỗ hổng nghiêm trọng (khóa này không được lộ).
 */
export async function discover(target) {
  const home = await get(target)
  if (home.status === 0) return { error: `Không tải được ${target}: ${home.error}` }

  const bodies = [home.text]
  for (const js of extractScripts(home.text, target).slice(0, 30)) {
    const r = await get(js)
    if (r.status === 200) bodies.push(r.text)
  }
  const blob = bodies.join('\n')

  let anonKey = null
  let serviceRoleKey = null
  for (const jwt of new Set(blob.match(JWT_RE) || [])) {
    const r = role(jwt)
    if (r === 'anon' && !anonKey) anonKey = jwt
    if (r === 'service_role' && !serviceRoleKey) serviceRoleKey = jwt
  }
  const supabaseUrl = (blob.match(SUPABASE_URL_RE) || [])[0] || null

  return { supabaseUrl, anonKey, serviceRoleKey }
}
