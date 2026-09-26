// Markdown rút gọn cho bài viết Knowledge — KHÔNG hỗ trợ HTML thô (an toàn, không XSS).
// Hỗ trợ: ## / ### tiêu đề, đoạn văn, - / 1. danh sách, > trích dẫn, bảng |a|b|, ![ảnh](https://…), --- kẻ ngang,
// dòng chỉ có link YouTube → video; trong dòng: **đậm**, *nghiêng*, `mã`, [chữ](link).

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'b'; c: Inline[] }
  | { t: 'i'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'a'; href: string; c: Inline[] }

export type Block =
  | { t: 'h'; level: 2 | 3; id: string; c: Inline[]; text: string }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'quote'; c: Inline[][] }
  | { t: 'img'; src: string; alt: string }
  | { t: 'video'; id: string }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { t: 'hr' }

const FOLD: Record<string, string> = {}
'àáảãạằắẳẵặăầấẩẫậâ'.split('').forEach((c) => (FOLD[c] = 'a'))
'èéẻẽẹềếểễệê'.split('').forEach((c) => (FOLD[c] = 'e'))
'ìíỉĩị'.split('').forEach((c) => (FOLD[c] = 'i'))
'òóỏõọồốổỗộôờớởỡợơ'.split('').forEach((c) => (FOLD[c] = 'o'))
'ùúủũụừứửữựư'.split('').forEach((c) => (FOLD[c] = 'u'))
'ỳýỷỹỵ'.split('').forEach((c) => (FOLD[c] = 'y'))
FOLD['đ'] = 'd'

/** "Kỹ thuật cơ bản" → "ky-thuat-co-ban" (neo mục lục, slug bài) */
export function slugify(s: string) {
  return s.normalize('NFC').toLowerCase().split('').map((c) => FOLD[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

/** Chỉ link an toàn: http(s), mailto, hoặc đường dẫn nội bộ "/…" (không "//") */
export function safeHref(href: string): string | null {
  const h = href.trim()
  if (/^https?:\/\//i.test(h) || /^mailto:/i.test(h)) return h
  if (h.startsWith('/') && !h.startsWith('//') && !h.startsWith('/\\')) return h
  return null
}

export function youtubeId(line: string): string | null {
  const m = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})\S*$/.exec(line.trim())
  return m ? m[1] : null
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ t: 'b', c: parseInline(m[1]) })
    else if (m[2] !== undefined) out.push({ t: 'i', c: parseInline(m[2]) })
    else if (m[3] !== undefined) out.push({ t: 'code', v: m[3] })
    else {
      const href = safeHref(m[5])
      out.push(href ? { t: 'a', href, c: parseInline(m[4]) } : { t: 'text', v: m[4] })
    }
    last = re.lastIndex
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) })
  return out
}

export const inlineText = (c: Inline[]): string =>
  c.map((x) => (x.t === 'text' || x.t === 'code' ? x.v : inlineText(x.c))).join('')

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((x) => parseInline(x.trim()))

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  const ids = new Map<string, number>()
  let para: string[] = []
  const flush = () => { if (para.length) { blocks.push({ t: 'p', c: parseInline(para.join(' ')) }); para = [] } }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) { flush(); continue }
    const h = /^(#{2,3})\s+(.+)$/.exec(trimmed) ?? /^#\s+(.+)$/.exec(trimmed)
    if (h) {
      flush()
      const level = (h.length === 3 && h[1].length === 3 ? 3 : 2) as 2 | 3
      const c = parseInline(h.length === 3 ? h[2] : h[1])
      const text = inlineText(c)
      const base = slugify(text) || 'muc'
      const n = ids.get(base) ?? 0
      ids.set(base, n + 1)
      blocks.push({ t: 'h', level, id: n ? `${base}-${n}` : base, c, text })
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) { flush(); blocks.push({ t: 'hr' }); continue }
    const img = /^!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)$/.exec(trimmed)
    if (img) { flush(); blocks.push({ t: 'img', alt: img[1], src: img[2] }); continue }
    const yt = youtubeId(trimmed)
    if (yt) { flush(); blocks.push({ t: 'video', id: yt }); continue }
    if (/^>\s?/.test(trimmed)) {
      flush()
      const q: string[] = []
      for (; i < lines.length && /^>\s?/.test(lines[i].trim()); i++) q.push(lines[i].trim().replace(/^>\s?/, ''))
      i--
      blocks.push({ t: 'quote', c: q.filter(Boolean).map(parseInline) })
      continue
    }
    if (/^[-*+]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      flush()
      const ordered = /^\d+[.)]\s+/.test(trimmed)
      const items: Inline[][] = []
      for (; i < lines.length; i++) {
        const l = lines[i].trim()
        const m = ordered ? /^\d+[.)]\s+(.*)$/.exec(l) : /^[-*+]\s+(.*)$/.exec(l)
        if (!m) break
        items.push(parseInline(m[1]))
      }
      i--
      blocks.push({ t: ordered ? 'ol' : 'ul', items })
      continue
    }
    if (trimmed.startsWith('|') && /^\|?\s*:?-{2,}/.test(lines[i + 1]?.trim() ?? '')) {
      flush()
      const head = cells(trimmed)
      const rows: Inline[][][] = []
      for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(cells(lines[i]))
      i--
      blocks.push({ t: 'table', head, rows })
      continue
    }
    para.push(trimmed)
  }
  flush()
  return blocks
}

/** Mục lục: các tiêu đề ## / ### */
export const tocOf = (blocks: Block[]) =>
  blocks.filter((b): b is Extract<Block, { t: 'h' }> => b.t === 'h').map((b) => ({ id: b.id, text: b.text, level: b.level }))
