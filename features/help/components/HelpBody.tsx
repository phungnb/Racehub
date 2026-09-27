'use client'

import { useMemo } from 'react'
import { Markdown, parseMarkdown } from '@/features/knowledge'
import { fillSiteInfo, type HelpPage } from '../model/help'

/** Chỉ phần nội dung Markdown của một trang menu — dùng trong trang có giao diện riêng (/goi, /doanh-nghiep) */
export function HelpBody({ page }: { page: HelpPage }) {
  const blocks = useMemo(() => parseMarkdown(fillSiteInfo(page.body, page.site)), [page.body, page.site])
  return <Markdown blocks={blocks} />
}
