'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { Input } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { adminListClubs } from '../../api/adminApi'
import { adminListChallenges } from '../../api/consoleApi'

export interface Picked { id: string; name: string }

/** Chọn một mục bằng ô tìm kiếm (CLB / thử thách); đã chọn thì hiện tên + nút bỏ */
function SearchPick({ value, onChange, placeholder, search, label }: {
  value: Picked | null
  onChange: (v: Picked | null) => void
  placeholder: string
  label: string
  search: (q: string) => Promise<Picked[]>
}) {
  const [q, setQ] = useState('')
  const term = q.trim()
  const res = useQuery({ queryKey: ['admin', 'pick', label, term], queryFn: () => search(term), enabled: term.length >= 2, staleTime: 30_000 })
  if (value) {
    return (
      <div className="flex h-11 items-center gap-2 rounded-xl border border-brand bg-brand/10 px-3 text-sm font-semibold">
        <span className="min-w-0 flex-1 truncate">{value.name}</span>
        <button type="button" onClick={() => onChange(null)} aria-label={`Bỏ ${label}`} className="grid size-8 place-items-center rounded-full hover:bg-surface-2">
          <X className="size-4" aria-hidden />
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="pl-9" aria-label={label} />
      </div>
      {term.length >= 2 && (
        <ul className="max-h-40 overflow-y-auto rounded-xl border border-border">
          {res.isPending ? <li className="px-3 py-2 text-xs text-fg-muted">Đang tìm…</li>
            : (res.data ?? []).length === 0 ? <li className="px-3 py-2 text-xs text-fg-muted">Không thấy kết quả</li>
            : res.data!.slice(0, 8).map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => { onChange(r); setQ('') }}
                  className={cn('w-full truncate px-3 py-2 text-left text-sm hover:bg-surface-2')}>{r.name}</button>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

export function ClubPick(props: { value: Picked | null; onChange: (v: Picked | null) => void }) {
  return <SearchPick {...props} label="CLB" placeholder="Tìm CLB (đồng phục: chỉ thành viên mua / mặc)"
    search={async (q) => (await adminListClubs(q)).map((c) => ({ id: c.id, name: c.name }))} />
}

export function ChallengePick(props: { value: Picked | null; onChange: (v: Picked | null) => void }) {
  return <SearchPick {...props} label="thử thách" placeholder="Tìm thử thách — hoàn thành mới nhận"
    search={async (q) => (await adminListChallenges(q, 'ALL')).map((c) => ({ id: c.id, name: c.title }))} />
}

export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)
