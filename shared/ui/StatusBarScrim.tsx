/**
 * Dải nền dưới thanh trạng thái (giờ, sóng, pin) cho trang không có thanh trên cố định (/goi, /help, /doanh-nghiep, /c/…).
 * App cài và PWA vẽ tràn lên vùng tai thỏ; thiếu dải này thì nội dung cuộn lên chồng vào giờ / pin. Trên web thường cao 0.
 */
export function StatusBarScrim() {
  return <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-30 h-[env(safe-area-inset-top)] bg-bg/90 backdrop-blur-md" />
}
