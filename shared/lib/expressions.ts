/**
 * Biểu cảm trong bình luận / chat: câu cổ vũ nhanh, emoji, sticker động.
 * Sticker được lưu như một câu chữ bình thường ("💪 Cố lên!") → thông báo, bản app cũ vẫn đọc được;
 * app nhận ra đúng câu đó thì vẽ thành sticker động. Không cần API key, không cần bảng dữ liệu mới.
 */
export interface Sticker { id: string; emoji: string; code: string; caption: string }

export const STICKERS: Sticker[] = [
  { id: 'co-len', emoji: '💪', code: '1f4aa', caption: 'Cố lên!' },
  { id: 'qua-dinh', emoji: '🔥', code: '1f525', caption: 'Quá đỉnh!' },
  { id: 'chuc-mung', emoji: '🎉', code: '1f389', caption: 'Chúc mừng!' },
  { id: 'tuyet-voi', emoji: '🥳', code: '1f973', caption: 'Tuyệt vời!' },
  { id: 'vo-tay', emoji: '👏', code: '1f44f', caption: 'Vỗ tay!' },
  { id: 'toc-do', emoji: '⚡', code: '26a1', caption: 'Tốc độ!' },
  { id: 'but-toc', emoji: '🚀', code: '1f680', caption: 'Bứt tốc!' },
  { id: 'pr-moi', emoji: '🏆', code: '1f3c6', caption: 'PR mới!' },
  { id: 've-nhat', emoji: '🥇', code: '1f947', caption: 'Về nhất!' },
  { id: 'thuong', emoji: '❤️', code: '2764_fe0f', caption: 'Thương lắm!' },
  { id: 'ngau', emoji: '😎', code: '1f60e', caption: 'Ngầu quá!' },
  { id: 'haha', emoji: '😂', code: '1f602', caption: 'Haha' },
  { id: 'nong', emoji: '🥵', code: '1f975', caption: 'Nắng quá!' },
  { id: 'nghi', emoji: '😴', code: '1f634', caption: 'Nghỉ ngơi nhé' },
  { id: 'cam-on', emoji: '🙏', code: '1f64f', caption: 'Cảm ơn!' },
  { id: 'hen-chay', emoji: '👟', code: '1f45f', caption: 'Hẹn chạy nhé!' },
]

export const stickerBody = (s: Sticker) => `${s.emoji} ${s.caption}`
const BY_BODY = new Map(STICKERS.map((s) => [stickerBody(s), s]))

/** Bình luận / tin nhắn chính là một sticker? */
export const stickerOf = (body: string | null | undefined) => (body ? BY_BODY.get(body.trim()) ?? null : null)

/** Ảnh động (Noto Animated Emoji, giấy phép CC BY 4.0). Không tải được thì app tự vẽ emoji có hiệu ứng. */
export const stickerImage = (s: Sticker) => `https://fonts.gstatic.com/s/e/notoemoji/latest/${s.code}/512.webp`

/** Câu cổ vũ nhanh: chạm là gửi */
export const QUICK_CHEERS = [
  'Cố lên! 💪', 'Quá đỉnh! 🔥', 'Chúc mừng PR mới! 🎉', 'Pace ngon quá ⚡', 'Đều chân thế 👏',
  'Hôm nào chạy cùng nhé 🏃', 'Nghỉ ngơi hồi phục nhé 🙏', 'Truyền động lực quá ❤️',
]

export const EMOJI_GROUPS: { label: string; items: string[] }[] = [
  { label: 'Cổ vũ', items: ['💪', '🔥', '👏', '🎉', '🥳', '⚡', '🚀', '🏆', '🥇', '🥈', '🥉', '🏅', '🎯', '✨', '💯', '🙌', '👍', '🤝'] },
  { label: 'Chạy bộ', items: ['🏃', '🏃‍♀️', '👟', '⏱️', '🗺️', '⛰️', '🌅', '🌄', '🌧️', '☀️', '🥵', '💦', '🧊', '🥤', '🍌', '🍜', '☕', '🩹'] },
  { label: 'Cảm xúc', items: ['😀', '😁', '😂', '🤣', '😊', '😍', '🥰', '😎', '🤩', '😅', '😮‍💨', '😴', '🤔', '😢', '😭', '😤', '🥲', '😇'] },
  { label: 'Trái tim', items: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💖', '💗', '💕', '🫶'] },
]

// Chỉ gồm 1–3 emoji (không chữ) → hiện to như sticker nhỏ
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic}️?)*\s*){1,3}$/u
export const isEmojiOnly = (body: string | null | undefined) => !!body && EMOJI_ONLY.test(body.trim())
