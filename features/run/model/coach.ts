// Giọng HLV: câu đọc cho từng sự kiện của phiên chạy (hàm thuần — test được, không phụ thuộc trình duyệt)
import { splitAnnouncement } from './tracker'
import type { SessionEvent } from './session'

/** Câu đọc cho một sự kiện; null = không đọc. Tự tạm dừng / tiếp tục chỉ đọc khi người chạy bật Tự tạm dừng. */
export function coachLine(e: SessionEvent, autoPauseOn: boolean): string | null {
  switch (e.type) {
    case 'START': return 'Bắt đầu chạy'
    case 'SPLIT': return splitAnnouncement(e.split, e.movingS)
    case 'AUTO_PAUSE': return autoPauseOn ? 'Tự tạm dừng' : null
    case 'AUTO_RESUME': return autoPauseOn ? 'Tiếp tục chạy' : null
    case 'LONG_STOP': return `Bạn đã đứng yên ${e.minutes} phút. Nếu đã chạy xong, hãy bấm Kết thúc.`
    case 'AUTO_STOPPED': return `Đã tạm dừng bài chạy vì bạn đứng yên ${e.minutes} phút.`
    case 'GAP': return null
  }
}

/** Mốc quan trọng → lưu tạm bài chạy ngay (không chờ nhịp 5 giây) */
export const persistsNow = (e: SessionEvent) => e.type === 'START' || e.type === 'SPLIT' || e.type === 'AUTO_STOPPED' || e.type === 'GAP'
