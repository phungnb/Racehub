'use client'

import { useQuery } from '@tanstack/react-query'
import { Mail, MessageCircle, Phone, Send } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { helpMenu } from '../api/helpApi'
import { contactLinks, type ContactKind } from '../model/help'

const ICON: Record<ContactKind, typeof Phone> = { phone: Phone, zalo: MessageCircle, telegram: Send, email: Mail }
const TONE: Record<ContactKind, string> = {
  phone: 'bg-brand/15 text-brand', zalo: 'bg-sky-500/15 text-sky-400', telegram: 'bg-cyan-500/15 text-cyan-400', email: 'bg-coin/15 text-coin',
}

/**
 * Liên hệ admin: điện thoại, Zalo, Telegram, email — admin nhập ở Quản trị → Cộng đồng → Hướng dẫn & chính sách → Thông tin công ty.
 * Chưa nhập kênh nào thì không hiện gì.
 */
export function ContactCard({ title = 'Liên hệ hỗ trợ', note, className }: { title?: string; note?: string; className?: string }) {
  const q = useQuery({ queryKey: ['help', 'menu'], queryFn: helpMenu, staleTime: 10 * 60_000 })
  const links = contactLinks(q.data?.site ?? {})
  if (!links.length) return null
  return (
    <section className={cn('space-y-2', className)} aria-label={title}>
      <h2 className="text-sm font-bold">{title}</h2>
      {note && <p className="text-xs text-fg-muted">{note}</p>}
      <ul className="grid gap-2 sm:grid-cols-2">
        {links.map((c) => {
          const Icon = ICON[c.kind]
          return (
            <li key={c.kind}>
              <a href={c.href} target={c.kind === 'zalo' || c.kind === 'telegram' ? '_blank' : undefined} rel="noopener noreferrer"
                className="flex min-h-12 items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2 hover:bg-surface-2">
                <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', TONE[c.kind])}><Icon className="size-4" aria-hidden /></span>
                <span className="min-w-0">
                  <span className="block text-xs text-fg-muted">{c.label}</span>
                  <span className="block truncate text-sm font-semibold">{c.value}</span>
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
