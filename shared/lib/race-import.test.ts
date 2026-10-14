import { describe, expect, it } from 'vitest'
import { guessDistances, parseRacePage } from './race-import'

describe('parseRacePage', () => {
  it('đọc JSON-LD Event', () => {
    const html = `<html><head><title>x</title><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Event","name":"Marathon A &amp; B 2026","startDate":"2026-11-15T05:00:00+07:00","endDate":"2026-11-15","location":{"name":"Công viên","address":{"streetAddress":"1 Lê Lợi","addressLocality":"Huế"}},"organizer":{"name":"BTC"},"image":["https://x.vn/a.jpg"],"description":"Cự ly 5K, 10K, 21K"}]}</script></head></html>`
    const d = parseRacePage(html)
    expect(d).toMatchObject({ title: 'Marathon A & B 2026', race_date: '2026-11-15', location: 'Công viên, 1 Lê Lợi, Huế', organizer: 'BTC', image_url: 'https://x.vn/a.jpg' })
    expect(d.distances).toEqual(['5K', '10K', '21K'])
  })
  it('rơi về og:title / <title> khi không có JSON-LD', () => {
    const d = parseRacePage('<head><meta property="og:title" content="Giải X"><meta content="mô tả" name="description"></head>')
    expect(d.title).toBe('Giải X')
    expect(d.description).toBe('mô tả')
    expect(d.race_date).toBe('')
  })
  it('JSON-LD hỏng không làm hỏng cả trang', () => {
    expect(parseRacePage('<title>T</title><script type="application/ld+json">{oops</script>').title).toBe('T')
  })
})

describe('guessDistances', () => {
  it('nhận 21km, half marathon, full marathon', () => {
    expect(guessDistances('10km, Half Marathon và Full Marathon')).toEqual(['10K', '21K', '42K'])
  })
})
