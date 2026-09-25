'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Block, Inline } from '../model/markdown'

function Inl({ c }: { c: Inline[] }): ReactNode {
  return c.map((x, i) => {
    switch (x.t) {
      case 'text': return <span key={i}>{x.v}</span>
      case 'b': return <strong key={i} className="font-semibold text-fg"><Inl c={x.c} /></strong>
      case 'i': return <em key={i}><Inl c={x.c} /></em>
      case 'code': return <code key={i} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.9em]">{x.v}</code>
      case 'a': return x.href.startsWith('/')
        ? <Link key={i} href={x.href} className="font-semibold text-brand underline underline-offset-2"><Inl c={x.c} /></Link>
        : <a key={i} href={x.href} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-brand underline underline-offset-2"><Inl c={x.c} /></a>
    }
  })
}

/** Hiển thị bài viết đã phân tích (xem model/markdown.ts) — không có HTML thô */
export function Markdown({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-4 text-[15px] leading-relaxed text-fg/90">
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'h': return b.level === 2
            ? <h2 key={i} id={b.id} className="scroll-mt-20 pt-2 text-xl font-bold text-fg"><Inl c={b.c} /></h2>
            : <h3 key={i} id={b.id} className="scroll-mt-20 text-base font-bold text-fg"><Inl c={b.c} /></h3>
          case 'p': return <p key={i}><Inl c={b.c} /></p>
          case 'ul': return <ul key={i} className="list-disc space-y-1.5 pl-5 marker:text-brand">{b.items.map((it, j) => <li key={j}><Inl c={it} /></li>)}</ul>
          case 'ol': return <ol key={i} className="list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-brand">{b.items.map((it, j) => <li key={j}><Inl c={it} /></li>)}</ol>
          case 'quote': return (
            <blockquote key={i} className="space-y-1 rounded-r-xl border-l-4 border-brand bg-brand/5 px-4 py-3 text-fg">
              {b.c.map((l, j) => <p key={j}><Inl c={l} /></p>)}
            </blockquote>
          )
          case 'img': return (
            <figure key={i} className="space-y-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element -- ảnh bài viết từ kho nội dung / nguồn https */}
              <img src={b.src} alt={b.alt} loading="lazy" className="w-full rounded-2xl border border-border object-cover" />
              {b.alt && <figcaption className="text-center text-xs text-fg-muted">{b.alt}</figcaption>}
            </figure>
          )
          case 'video': return (
            <div key={i} className="aspect-video overflow-hidden rounded-2xl border border-border bg-black">
              <iframe src={`https://www.youtube-nocookie.com/embed/${b.id}`} title="Video" loading="lazy" className="size-full"
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
            </div>
          )
          case 'table': return (
            <div key={i} className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-max border-collapse text-sm">
                <thead><tr>{b.head.map((c, j) => <th key={j} className="border-b border-border px-2 py-2 text-left font-semibold text-fg"><Inl c={c} /></th>)}</tr></thead>
                <tbody>{b.rows.map((r, j) => <tr key={j} className="border-b border-border/60">{r.map((c, k) => <td key={k} className="px-2 py-2 align-top"><Inl c={c} /></td>)}</tr>)}</tbody>
              </table>
            </div>
          )
          case 'hr': return <hr key={i} className="border-border" />
        }
      })}
    </div>
  )
}
