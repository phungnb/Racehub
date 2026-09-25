import { matchRanges } from '@/shared/lib/search'

/** Tô đậm phần khớp với câu tìm (không phân biệt dấu) */
export function Highlight({ text, query }: { text: string; query: string }) {
  const ranges = matchRanges(text, query)
  if (!ranges.length) return <>{text}</>
  const chars = [...text]
  const parts: React.ReactNode[] = []
  let at = 0
  ranges.forEach(([a, b], i) => {
    if (a > at) parts.push(chars.slice(at, a).join(''))
    parts.push(<mark key={i} className="rounded-sm bg-brand/25 px-0.5 text-inherit">{chars.slice(a, b).join('')}</mark>)
    at = b
  })
  if (at < chars.length) parts.push(chars.slice(at).join(''))
  return <>{parts}</>
}
