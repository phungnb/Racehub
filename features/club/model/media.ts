// Tin CLB + kho link ảnh: nhãn, màu, nhận diện dịch vụ lưu ảnh từ link. Hàm thuần.
import type { NewsCategory } from '../api/postsApi'

export const NEWS_CATEGORIES: Record<NewsCategory, { label: string; tone: string }> = {
  NOTICE: { label: 'Thông báo', tone: 'bg-coin/15 text-coin' },
  EVENT: { label: 'Sự kiện', tone: 'bg-brand/15 text-brand' },
  RACE: { label: 'Giải chạy', tone: 'bg-live/15 text-live' },
  RESULT: { label: 'Kết quả', tone: 'bg-xp/15 text-xp' },
  TRAINING: { label: 'Tập luyện', tone: 'bg-sky-500/15 text-sky-400' },
  OTHER: { label: 'Khác', tone: 'bg-surface-2 text-fg-muted' },
}

export type AlbumKind = 'EVENT' | 'RACE' | 'TRAINING' | 'SOCIAL' | 'OTHER'
export const ALBUM_KINDS: Record<AlbumKind, string> = { EVENT: 'Sự kiện CLB', RACE: 'Giải chạy', TRAINING: 'Buổi tập', SOCIAL: 'Giao lưu', OTHER: 'Khác' }

export interface Provider { name: string; color: string }
const PROVIDERS: [RegExp, Provider][] = [
  [/photos\.(app\.)?goo\.gl|photos\.google\.com/i, { name: 'Google Photos', color: '#4285F4' }],
  [/drive\.google\.com/i, { name: 'Google Drive', color: '#0F9D58' }],
  [/facebook\.com|fb\.com|fb\.watch/i, { name: 'Facebook', color: '#1877F2' }],
  [/icloud\.com/i, { name: 'iCloud', color: '#3693F3' }],
  [/1drv\.ms|onedrive\.live\.com|sharepoint\.com/i, { name: 'OneDrive', color: '#0078D4' }],
  [/flickr\.com|flic\.kr/i, { name: 'Flickr', color: '#FF0084' }],
  [/dropbox\.com/i, { name: 'Dropbox', color: '#0061FF' }],
  [/zalo\.me|zaloapp\.com/i, { name: 'Zalo', color: '#0068FF' }],
  [/youtube\.com|youtu\.be/i, { name: 'YouTube', color: '#FF0000' }],
  [/raceful|vietrace365|irace\.vn|chupanh|photo/i, { name: 'Ảnh giải', color: '#b6ff3b' }],
]

/** Nhận diện dịch vụ từ link album (hiện nhãn + màu trên thẻ) */
export function providerOf(url: string): Provider {
  for (const [re, p] of PROVIDERS) if (re.test(url)) return p
  try { return { name: new URL(url).hostname.replace(/^www\./, ''), color: '#8b93a7' } } catch { return { name: 'Link', color: '#8b93a7' } }
}

export const isHttpUrl = (s: string) => /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(s.trim())

/** "20/09/2026" */
export const formatDay = (d: string) => { const [y, m, dd] = d.slice(0, 10).split('-'); return `${dd}/${m}/${y}` }
