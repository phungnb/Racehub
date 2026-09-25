'use client'

import { useState } from 'react'
import { Info, TriangleAlert, Wrench, X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { useSystemNotice } from '../hooks/useSystem'
import type { NoticeLevel } from '../api/systemApi'

const STYLE: Record<NoticeLevel, { icon: typeof Info; cls: string }> = {
  INFO: { icon: Info, cls: 'bg-brand/15 text-fg border-brand/30' },
  WARNING: { icon: TriangleAlert, cls: 'bg-coin/15 text-fg border-coin/40' },
  MAINTENANCE: { icon: Wrench, cls: 'bg-danger/15 text-fg border-danger/40' },
}
const KEY = 'rh-notice-dismissed'
const readDismissed = () => { try { return localStorage.getItem(KEY) } catch { return null } }

/** Thông báo chung do admin đặt (Quản trị → Hệ thống). Bảo trì thì không tắt được; loại khác bấm × để ẩn. */
export function SystemNoticeBanner() {
  const { data: n } = useSystemNotice()
  const [dismissed, setDismissed] = useState<string | null>(readDismissed)
  if (!n) return null
  const id = `${n.level}|${n.updated_at}`
  if (n.level !== 'MAINTENANCE' && dismissed === id) return null
  const s = STYLE[n.level] ?? STYLE.INFO
  const Icon = s.icon
  const dismiss = () => { try { localStorage.setItem(KEY, id) } catch {} setDismissed(id) }
  return (
    <div role={n.level === 'INFO' ? 'status' : 'alert'} className={cn('mx-auto flex max-w-md items-start gap-2 border-b px-4 py-2 text-sm', s.cls)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{n.title}</p>
        {n.message && <p className="text-xs text-fg-muted">{n.message}</p>}
        {n.until && <p className="text-[11px] text-fg-subtle">Đến {new Date(n.until).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</p>}
      </div>
      {n.level !== 'MAINTENANCE' && (
        <button onClick={dismiss} aria-label="Ẩn thông báo" className="-m-1 grid size-8 place-items-center rounded-lg text-fg-muted hover:text-fg"><X className="size-4" /></button>
      )}
    </div>
  )
}
