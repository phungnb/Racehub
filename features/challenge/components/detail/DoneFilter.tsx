'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { cn } from '@/shared/lib/cn'

export type DoneMode = 'ALL' | 'DONE' | 'NOT'
const PARAM: Record<DoneMode, string | null> = { ALL: null, DONE: 'da-xong', NOT: 'chua-xong' }

/** Bộ lọc Hoàn thành / Chưa hoàn thành; đồng bộ ?loc=da-xong|chua-xong để gửi link thẳng tới danh sách */
export function useDoneFilter() {
  const sp = useSearchParams()
  const init = sp.get('loc') === 'chua-xong' ? 'NOT' : sp.get('loc') === 'da-xong' ? 'DONE' : 'ALL'
  const [mode, setMode] = useState<DoneMode>(init)
  const set = (m: DoneMode) => {
    setMode(m)
    const url = new URL(window.location.href)
    if (PARAM[m]) url.searchParams.set('loc', PARAM[m]!); else url.searchParams.delete('loc')
    window.history.replaceState(null, '', url.toString())
  }
  return [mode, set] as const
}

export function DoneFilter({ mode, onChange, done, total, ended }: { mode: DoneMode; onChange: (m: DoneMode) => void; done: number; total: number; ended: boolean }) {
  const opts: { v: DoneMode; label: string; n: number }[] = [
    { v: 'ALL', label: 'Tất cả', n: total },
    { v: 'DONE', label: 'Hoàn thành', n: done },
    { v: 'NOT', label: ended ? 'Không hoàn thành' : 'Chưa hoàn thành', n: total - done },
  ]
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]" role="tablist" aria-label="Lọc theo kết quả">
      {opts.map((o) => (
        <button key={o.v} type="button" role="tab" aria-selected={mode === o.v} onClick={() => onChange(o.v)}
          className={cn('shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold',
            mode === o.v ? (o.v === 'NOT' ? 'border-danger bg-danger/15 text-danger' : 'border-brand bg-brand text-brand-fg') : 'border-border text-fg-muted')}>
          {o.label} · {o.n}
        </button>
      ))}
    </div>
  )
}
