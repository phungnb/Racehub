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

export function errorMessage(err: unknown, fallback = 'Đã có lỗi xảy ra. Vui lòng thử lại.') {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const code = Object.keys(MESSAGES).find((k) => raw.includes(k))
  return code ? MESSAGES[code] : raw || fallback
}
