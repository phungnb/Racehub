'use client'

import { Crosshair, Search, X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

/** Ô tìm nhanh VĐV trên bảng xếp hạng: gõ tên (không dấu, viết tắt đều được) để lọc, nút "Tôi" nhảy tới dòng của mình */
export function RankSearch({ value, onChange, total, matched, onFindMe, placeholder = 'Tìm VĐV trên bảng…', className }: {
  value: string; onChange: (v: string) => void; total: number; matched: number
  onFindMe?: () => void; placeholder?: string; className?: string
}) {
  const searching = value.trim().length > 0
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex gap-2">
        <label className="relative block flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label="Tìm vận động viên trên bảng xếp hạng"
            className="h-10 w-full rounded-xl border border-border bg-bg pl-9 pr-9 text-sm placeholder:text-fg-subtle focus:border-brand focus:outline-none [&::-webkit-search-cancel-button]:hidden" />
          {searching && (
            <button type="button" onClick={() => onChange('')} aria-label="Xóa tìm kiếm"
              className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-fg-subtle hover:bg-surface-2">
              <X className="size-4" aria-hidden />
            </button>
          )}
        </label>
        {onFindMe && (
          <button type="button" onClick={() => { onChange(''); onFindMe() }}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold text-fg-muted hover:text-fg">
            <Crosshair className="size-4" aria-hidden />Tôi
          </button>
        )}
      </div>
      {searching && <p className="px-1 text-xs text-fg-subtle" aria-live="polite">{matched ? `Tìm thấy ${matched}/${total} VĐV` : 'Không có VĐV nào khớp tên này'}</p>}
    </div>
  )
}

/** Cuộn tới dòng có id và nháy sáng để mắt dễ bắt */
export function scrollToRow(id: string) {
  const el = document.getElementById(id)
  if (!el) return false
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.animate?.([{ boxShadow: '0 0 0 3px var(--color-brand)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1600, easing: 'ease-out' })
  return true
}
