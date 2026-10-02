// Đọc bản mô tả OpenAPI của PostgREST MỘT LẦN, dùng chung cho mọi kiểm tra.
//
// Điểm cốt lõi: PostgREST sinh OpenAPI THEO VAI TRÒ của khóa gửi lên. Khi dùng
// khóa anon, bản mô tả chỉ chứa bảng/RPC và các method (get/post/patch/delete) mà
// vai trò anon được cấp. Nhờ vậy ta suy ra "anon ghi được bảng X" hay "anon gọi
// được RPC Y" chỉ bằng cách ĐỌC — không gửi lệnh ghi, không gọi RPC. Đây là nền
// cho tính "không phá" của secscan.
import { get, parseJson } from './http.js'

const WRITE_METHODS = ['post', 'patch', 'put', 'delete']

/**
 * Trả về { ok, note?, tables: [{name, methods}], rpcs: [name] }.
 * tables/rpcs là những gì vai trò anon NHÌN THẤY (tức có quyền tương ứng).
 */
export async function fetchSpec({ base, anonKey }) {
  const r = await get(`${base}/rest/v1/`, { apikey: anonKey, Authorization: `Bearer ${anonKey}` })
  if (r.status !== 200) {
    return { ok: false, note: `Không đọc được /rest/v1/ (HTTP ${r.status || r.error}).`, tables: [], rpcs: [] }
  }
  const spec = parseJson(r.text)
  if (!spec || !spec.paths) {
    return { ok: false, note: 'Phản hồi /rest/v1/ không phải OpenAPI (có thể không phải PostgREST).', tables: [], rpcs: [] }
  }

  const tables = []
  const rpcs = []
  for (const [path, ops] of Object.entries(spec.paths)) {
    if (path === '/' || !path.startsWith('/')) continue
    const name = path.slice(1)
    if (name.startsWith('rpc/')) {
      rpcs.push(name.slice(4))
      continue
    }
    const methods = Object.keys(ops || {}).map((m) => m.toLowerCase())
    tables.push({ name, methods })
  }
  return { ok: true, tables, rpcs, writeMethods: WRITE_METHODS }
}

export { WRITE_METHODS }
