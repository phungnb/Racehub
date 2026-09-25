import { describe, expect, it } from 'vitest'
import { canTrackLocation, fromNative, tracksInBackground } from './location'

const loc = { latitude: 21.03, longitude: 105.85, accuracy: 6, altitude: 12, altitudeAccuracy: 3, bearing: 90, speed: 3.1, time: 1_700_000_000_000, simulated: false }

describe('nguồn vị trí', () => {
  it('điểm từ app cài được đổi đúng; điểm do app giả lập GPS tạo thì bỏ', () => {
    expect(fromNative(loc)).toEqual({ latitude: 21.03, longitude: 105.85, accuracy: 6, altitude: 12, speed: 3.1, time: 1_700_000_000_000 })
    expect(fromNative({ ...loc, simulated: true })).toBeNull()
  })
  it('ngoài app cài (trình duyệt / máy chủ): không ghi nền', () => {
    expect(tracksInBackground()).toBe(false)
    expect(typeof canTrackLocation()).toBe('boolean')
  })
})
