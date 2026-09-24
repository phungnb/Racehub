// Tìm kiếm tiếng Việt phía client, cùng quy tắc với private.search_key (migration 003100):
// bỏ dấu, không phân biệt hoa thường / Unicode dựng sẵn hay tổ hợp, nhiều từ không cần đúng thứ tự, viết tắt chữ cái đầu.
import { useEffect, useState } from 'react'

/** "  Đặng ÁNH-Dũng! " → "dang anh dung" */
export function searchKey(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD').replace(/\p{M}+/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function hay(fields: (string | null | undefined)[]) {
  return fields.map((f) => {
    const k = searchKey(f)
    const words = k.split(' ').filter(Boolean)
    return ` ${k} ${words.length > 1 ? words.map((w) => w[0]).join('') : ''} `
  }).join(' ')
}

/** Mọi từ của câu tìm đều có trong một trong các trường (câu tìm trống → luôn khớp) */
export function matchesSearch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const tokens = searchKey(query).split(' ').filter(Boolean)
  if (!tokens.length) return true
  const h = hay(fields)
  return tokens.every((t) => h.includes(t))
}

/** Điểm xếp hạng (nhỏ = khớp hơn): 0 trùng, 1 bắt đầu bằng, 2 đầu một từ / viết tắt, 3 chứa */
export function searchRank(query: string, name: string | null | undefined): number {
  const q = searchKey(query), k = searchKey(name)
  if (!q) return 0
  if (k === q) return 0
  if (k.startsWith(q)) return 1
  return hay([name]).includes(` ${q}`) ? 2 : 3
}

/** Lọc + xếp danh sách theo câu tìm */
export function filterSearch<T>(items: T[], query: string, fields: (x: T) => (string | null | undefined)[]): T[] {
  if (!searchKey(query)) return items
  return items
    .filter((x) => matchesSearch(query, ...fields(x)))
    .map((x, i) => ({ x, i, r: searchRank(query, fields(x)[0]) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((e) => e.x)
}

/** Giá trị trễ `ms` sau lần gõ cuối → không gọi máy chủ mỗi phím */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
