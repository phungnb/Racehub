import { describe, it, expect } from 'vitest'
import { isEmojiOnly, STICKERS, stickerBody, stickerOf } from './expressions'

describe('biểu cảm', () => {
  it('nhận ra sticker từ nội dung chữ', () => {
    const s = STICKERS[0]
    expect(stickerOf(stickerBody(s))).toEqual(s)
    expect(stickerOf(` ${stickerBody(s)} `)).toEqual(s)
    expect(stickerOf('Cố lên! 💪')).toBeNull()
    expect(stickerOf('')).toBeNull()
    expect(new Set(STICKERS.map(stickerBody)).size).toBe(STICKERS.length)
  })
  it('chỉ có emoji → hiện to', () => {
    expect(isEmojiOnly('🔥')).toBe(true)
    expect(isEmojiOnly('🔥🔥🔥')).toBe(true)
    expect(isEmojiOnly('🏃‍♀️ ❤️')).toBe(true)
    expect(isEmojiOnly('👍🏽')).toBe(true)
    expect(isEmojiOnly('🔥🔥🔥🔥')).toBe(false)
    expect(isEmojiOnly('Hay 🔥')).toBe(false)
    expect(isEmojiOnly('123')).toBe(false)
  })
})
