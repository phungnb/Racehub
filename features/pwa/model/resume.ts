// Mở lại app sau một lúc (tắt màn hình, chuyển app, vừa chạy xong): tải lại những gì đang hiện trên màn.
// Kết nối realtime bị ngắt khi máy ngủ nên có thể đã lỡ sự kiện (bài chạy mới về, phần thưởng, tin nhắn…).
export const RESUME_AFTER_MS = 20_000

/** Có nên làm mới khi quay lại không: đã ẩn đủ lâu */
export function shouldRefreshOnResume(hiddenAt: number | null, now: number) {
  return hiddenAt !== null && now - hiddenAt >= RESUME_AFTER_MS
}
