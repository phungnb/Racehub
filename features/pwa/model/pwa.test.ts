import { describe, it, expect } from 'vitest'
import { detectPlatform, isIosSafari } from './pwa'

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1'
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'

describe('pwa: nhận diện nền tảng', () => {
  it('phân biệt iOS / Android / máy tính (kể cả iPad giả làm Mac)', () => {
    expect(detectPlatform(IPHONE_SAFARI)).toBe('ios')
    expect(detectPlatform(IPAD_DESKTOP, 5)).toBe('ios')
    expect(detectPlatform(IPAD_DESKTOP, 0)).toBe('desktop')
    expect(detectPlatform(ANDROID)).toBe('android')
  })
  it('iOS chỉ hướng dẫn cài khi đang ở Safari', () => {
    expect(isIosSafari(IPHONE_SAFARI)).toBe(true)
    expect(isIosSafari(IPHONE_CHROME)).toBe(false)
  })
})
