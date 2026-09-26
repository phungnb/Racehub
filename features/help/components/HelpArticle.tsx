'use client'

import { useMemo } from 'react'
import { Markdown, parseMarkdown } from '@/features/knowledge'
import { fillSiteInfo, type HelpPage } from '../model/help'

const date = (d: string | null) => (d ? new Date(d).toLocaleDateString('vi-VN') : null)

/** Nội dung một trang hướng dẫn / chính sách (Markdown + thông tin pháp nhân điền sẵn) */
export function HelpArticle({ page }: { page: HelpPage }) {
  const blocks = useMemo(() => parseMarkdown(fillSiteInfo(page.body, page.site)), [page.body, page.site])
  const effective = date(page.effective_at)
  return (
    <article>
      <h1 className="flex items-start gap-2 text-2xl font-bold leading-tight">
        {page.icon && <span aria-hidden>{page.icon}</span>}<span>{page.title}</span>
      </h1>
      {page.section === 'POLICY' && (
        <p className="mt-1 text-sm text-fg-muted">
          Phiên bản {page.version}{effective && ` · hiệu lực từ ${effective}`} · cập nhật {date(page.updated_at)}
        </p>
      )}
      {!page.is_published && <p className="mt-3 rounded-xl bg-warning/15 p-3 text-sm text-warning">Trang đang ẩn — chỉ quản trị viên xem được.</p>}
      {page.summary && page.section !== 'POLICY' && <p className="mt-2 text-fg-muted">{page.summary}</p>}
      <div className="mt-5"><Markdown blocks={blocks} /></div>
    </article>
  )
}
