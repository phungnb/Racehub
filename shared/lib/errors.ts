// Phân loại lỗi dùng chung để người dùng luôn biết chuyện gì xảy ra và nên làm gì.
// Lỗi nghiệp vụ (mã riêng như INSUFFICIENT_BALANCE) do từng tính năng tự dịch; ở đây lo các lỗi hệ thống.

export type ErrorKind = 'OFFLINE' | 'NETWORK' | 'TIMEOUT' | 'AUTH' | 'FORBIDDEN' | 'NOT_DEPLOYED' | 'RATE_LIMIT' | 'SERVER' | 'UNKNOWN'

export interface AppError {
  kind: ErrorKind
  title: string
  message: string
  /** Mã ngắn để người dùng báo lại cho hỗ trợ */
  code: string
  retryable: boolean
}

interface RawError { message?: string; code?: string; status?: number; name?: string; details?: string; hint?: string }

const TEXT: Record<ErrorKind, { title: string; message: string; retryable: boolean }> = {
  OFFLINE: { title: 'Bạn đang ngoại tuyến', message: 'Kiểm tra Wi-Fi hoặc 4G rồi thử lại. Dữ liệu đang hiện có thể chưa mới nhất.', retryable: true },
  NETWORK: { title: 'Không kết nối được máy chủ', message: 'Mạng chập chờn hoặc máy chủ tạm thời không phản hồi. Thử lại sau ít phút.', retryable: true },
  TIMEOUT: { title: 'Máy chủ phản hồi chậm', message: 'Yêu cầu mất quá nhiều thời gian. Thử lại sau ít phút.', retryable: true },
  AUTH: { title: 'Phiên đăng nhập đã hết hạn', message: 'Vui lòng đăng nhập lại để tiếp tục.', retryable: false },
  FORBIDDEN: { title: 'Bạn không có quyền', message: 'Tài khoản của bạn không được phép thực hiện việc này.', retryable: false },
  NOT_DEPLOYED: { title: 'Tính năng đang được cập nhật', message: 'Máy chủ chưa có bản cập nhật mới nhất cho tính năng này. Đội ngũ RaceHub đã được báo, vui lòng quay lại sau.', retryable: false },
  RATE_LIMIT: { title: 'Thao tác quá nhanh', message: 'Bạn thao tác quá nhiều lần liên tiếp. Đợi một chút rồi thử lại.', retryable: true },
  SERVER: { title: 'Hệ thống đang gặp sự cố', message: 'Máy chủ gặp lỗi khi xử lý. Đội ngũ RaceHub đã được báo, vui lòng thử lại sau.', retryable: true },
  UNKNOWN: { title: 'Có lỗi không mong muốn', message: 'Đã có lỗi xảy ra. Thử lại; nếu vẫn lỗi, gửi mã lỗi bên dưới cho đội ngũ hỗ trợ.', retryable: true },
}

export function errorKind(e: unknown, online = typeof navigator === 'undefined' || navigator.onLine !== false): ErrorKind {
  const r = (e ?? {}) as RawError
  const msg = `${r.message ?? ''} ${r.details ?? ''}`.toLowerCase()
  const code = String(r.code ?? '')
  const status = Number(r.status ?? 0)
  if (!online) return 'OFFLINE'
  if (r.name === 'AbortError' || /timeout|timed out|statement_timeout/.test(msg) || code === '57014') return 'TIMEOUT'
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|err_network|err_internet/.test(msg)) return 'NETWORK'
  if (status === 401 || /jwt expired|invalid jwt|auth_required|refresh token|not authenticated|session.*(expired|missing)/.test(msg) || code === 'PGRST301' || code === 'PGRST303') return 'AUTH'
  if (code === 'PGRST202' || code === 'PGRST205' || code === '42883' || code === '42P01' || code === '42703'
      || /could not find the function|schema cache|does not exist/.test(msg)) return 'NOT_DEPLOYED'
  if (status === 403 || code === '42501' || /permission denied|forbidden/.test(msg)) return 'FORBIDDEN'
  if (status === 429 || /too many requests|rate limit|too_soon|too_many/.test(msg)) return 'RATE_LIMIT'
  if (status >= 500 || /^PGRST00[0-3]$/.test(code) || code.startsWith('08') || code === '53300' || /internal server error|bad gateway|service unavailable|gateway timeout|upstream|connect error|econnrefused|<html|cloudflare/.test(msg)) return 'SERVER'
  return 'UNKNOWN'
}

/** Mã lỗi ngắn, ổn định cho cùng một loại lỗi — người dùng đọc cho hỗ trợ, admin tra trong trang Hệ thống */
export function errorCode(e: unknown, kind: ErrorKind): string {
  const r = (e ?? {}) as RawError
  const raw = `${kind}|${r.code ?? ''}|${(r.message ?? '').replace(/[0-9a-f-]{36}/gi, '').slice(0, 80)}`
  let h = 0
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0
  return `${kind.slice(0, 3)}-${(h % 46656).toString(36).toUpperCase().padStart(3, '0')}`
}

export function describeError(e: unknown, online?: boolean): AppError {
  const kind = errorKind(e, online)
  return { kind, ...TEXT[kind], code: errorCode(e, kind) }
}

/** Lỗi hệ thống (không phải lỗi nghiệp vụ có mã riêng) — dùng làm câu trả lời mặc định cho các hàm xxxErrorMessage */
export function systemErrorMessage(e: unknown, fallback?: string): string {
  const d = describeError(e)
  if (d.kind !== 'UNKNOWN') return `${d.title}. ${d.message}`
  return `${fallback ?? d.message.split('.')[0] + '.'} (Mã lỗi ${d.code})`
}

/** Không nên thử lại tự động khi lỗi do quyền / phiên / chưa cập nhật máy chủ */
export const shouldRetry = (e: unknown) => !['AUTH', 'FORBIDDEN', 'NOT_DEPLOYED', 'RATE_LIMIT'].includes(errorKind(e))

// Dịch mã lỗi từ RPC (raise exception 'MÃ') sang thông báo tiếng Việt — xem docs/architecture/api.md §5
const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'Bạn cần đăng nhập để tiếp tục.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  INSUFFICIENT_BALANCE: 'Số dư Xu không đủ.',
  INSUFFICIENT_FUNDS: 'Số dư Xu không đủ.',
  INVALID_TITLE: 'Tên thử thách cần từ 3 đến 120 ký tự.',
  INVALID_TIME_RANGE: 'Thời gian kết thúc phải sau thời gian bắt đầu.',
  INVALID_MAX_SLOTS: 'Số người tham gia tối đa không hợp lệ (1 – 10.000).',
  INVALID_DISTANCE: 'Cự ly không hợp lệ.',
  INVALID_PACE: 'Khoảng pace không hợp lệ.',
  INVALID_CHALLENGE_TYPE: 'Loại thử thách không hợp lệ.',
  IDEMPOTENCY_KEY_REQUIRED: 'Yêu cầu không hợp lệ, vui lòng thử lại.',
  ACTIVITY_DUPLICATE: 'Bài chạy này đã được lưu trước đó.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh, thử lại sau ít phút.',
  NOT_A_MEMBER: 'Bạn chưa là thành viên CLB này.',
}

export function errorMessage(err: unknown, fallback?: string) {
  const raw = (err as { message?: string } | null)?.message ?? (typeof err === 'string' ? err : '')
  const code = Object.keys(MESSAGES).find((k) => raw.includes(k))
  return code ? MESSAGES[code] : fallback ?? systemErrorMessage(err)
}
