'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Headset, MessageCircle } from 'lucide-react'
import { Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { helpMenu } from '../api/helpApi'
import { contactLinks } from '../model/help'
import { ContactCard } from './ContactCard'

/** Có kênh liên hệ nào chưa (admin nhập ở Thông tin công ty)? Chưa có thì các nút liên hệ tự ẩn */
export function useHasContact() {
  const q = useQuery({ queryKey: ['help', 'menu'], queryFn: helpMenu, staleTime: 10 * 60_000 })
  return contactLinks(q.data?.site ?? {}).length > 0
}

function ContactSheet({ open, onClose, title, note }: { open: boolean; onClose: () => void; title: string; note?: string }) {
  return (
    <Sheet open={open} onClose={onClose} title={title} description={note ?? 'Chọn kênh bạn tiện nhất — admin RaceHub trả lời trong giờ làm việc.'}>
      <ContactCard title="Kênh liên hệ" />
    </Sheet>
  )
}

/** Biểu tượng tai nghe có sóng lan (chạy 4 lần rồi đứng yên; tắt khi người dùng bật "giảm chuyển động") */
function PulseIcon({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-14' : size === 'md' ? 'size-9' : 'size-8'
  const icon = size === 'lg' ? 'size-6' : 'size-4'
  return (
    <span className={cn('relative grid shrink-0 place-items-center', box)} aria-hidden>
      <span className="absolute inset-0 rounded-full bg-brand/60 animate-ripple" />
      <span className="absolute inset-0 rounded-full bg-brand/40 animate-ripple [animation-delay:0.6s]" />
      <span className={cn('relative grid place-items-center rounded-full bg-brand text-brand-fg shadow-lg shadow-brand/30', box)}>
        <MessageCircle className={cn(icon, 'animate-wiggle')} />
      </span>
    </span>
  )
}

/** Ô nổi bật trong menu ☰ — chạm mở rộng ngay các kênh liên hệ (không chồng thêm bảng lên menu) */
export function ContactMenuRow() {
  const has = useHasContact()
  const [open, setOpen] = useState(false)
  if (!has) return null
  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-2xl border border-brand/40 bg-brand/10 px-3 py-2.5 text-left hover:bg-brand/15">
        <PulseIcon size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">Liên hệ hỗ trợ</span>
          <span className="block text-xs text-fg-muted">Zalo, Telegram, điện thoại — hỏi gì cũng được</span>
        </span>
      </button>
      {open && <ContactCard title="Chọn kênh liên hệ" />}
    </div>
  )
}

/** Nút nhỏ "Cần giúp đỡ?" (đầu trang Cài đặt) */
export function ContactButton({ className }: { className?: string }) {
  const has = useHasContact()
  const [open, setOpen] = useState(false)
  if (!has) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={cn('inline-flex min-h-10 items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-3 text-sm font-semibold text-brand hover:bg-brand/15', className)}>
        <Headset className="size-4 animate-wiggle" aria-hidden />Cần giúp đỡ?
      </button>
      <ContactSheet open={open} onClose={() => setOpen(false)} title="Cần giúp đỡ?" />
    </>
  )
}

/**
 * Nút nổi "Liên hệ" — CHỈ dùng ở trang bán hàng (Gói, Nạp Xu / Ví, Doanh nghiệp).
 * withNav: trang trong app có thanh điều hướng dưới → đặt cao hơn để không che nút Chạy.
 */
export function ContactFab({ withNav = false, title = 'Cần tư vấn?', note }: { withNav?: boolean; title?: string; note?: string }) {
  const has = useHasContact()
  const [open, setOpen] = useState(false)
  if (!has) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Liên hệ tư vấn"
        className={cn('fixed right-3 z-40 flex flex-col items-center gap-0.5 sm:right-[max(0.75rem,calc(50vw-14rem+0.75rem))]',
          withNav ? 'bottom-[calc(4.5rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(1rem+env(safe-area-inset-bottom))]')}>
        <PulseIcon size="lg" />
        <span className="rounded-full bg-bg/90 px-2 text-[11px] font-bold text-brand shadow">Liên hệ</span>
      </button>
      <ContactSheet open={open} onClose={() => setOpen(false)} title={title} note={note} />
    </>
  )
}
