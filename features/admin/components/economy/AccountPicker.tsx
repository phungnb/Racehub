'use client'

import { useEffect, useState } from 'react'
import { Search, Shield, User, X } from 'lucide-react'
import { Avatar, Input, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin } from '@/shared/lib/format'
import type { AccountHit } from '../../api/adminApi'
import { useAccountSearch } from '../../hooks/useAdmin'

/** Tìm người dùng (tên, email, id) hoặc CLB (tên, id) để điều phối */
export function AccountPicker({ value, onChange, id }: { value: AccountHit | null; onChange: (a: AccountHit | null) => void; id: string }) {
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t) }, [text])
  const search = useAccountSearch(q)

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-brand/50 bg-brand/5 p-3">
        <AccountIcon a={value} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{value.name}</p>
          <p className="truncate text-xs text-fg-muted">{value.kind === 'CLUB' ? 'Quỹ CLB' : 'Ví cá nhân'} · {value.subtitle}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-semibold text-coin">{formatCoin(value.balance)}</p>
          <p className="text-xs text-fg-subtle">Xu</p>
        </div>
        <button onClick={() => onChange(null)} aria-label="Chọn tài khoản khác"
          className="-mr-1 grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2"><X className="size-4" aria-hidden /></button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <Input id={id} value={text} onChange={(e) => setText(e.target.value)} className="pl-9"
          placeholder="Tên, email người dùng, tên CLB hoặc ID" autoComplete="off" />
      </div>
      {q.length >= 2 && (
        <div className="overflow-hidden rounded-xl border border-border" role="listbox" aria-label="Kết quả tìm kiếm">
          {search.isPending ? (
            <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : search.isError ? (
            <p className="p-3 text-sm text-danger">Không tìm được. Thử lại sau.</p>
          ) : !search.data?.length ? (
            <p className="p-3 text-sm text-fg-muted">Không có tài khoản nào khớp “{q}”.</p>
          ) : (
            search.data.map((a) => (
              <button key={`${a.kind}-${a.id}`} role="option" aria-selected={false} onClick={() => { onChange(a); setText('') }}
                className="flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left last:border-0 hover:bg-surface-2">
                <AccountIcon a={a} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{a.name}</span>
                  <span className="block truncate text-xs text-fg-muted">{a.subtitle}</span>
                </span>
                <span className="font-mono text-sm text-coin">{formatCoin(a.balance)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function AccountIcon({ a }: { a: AccountHit }) {
  return (
    <span className="relative">
      <Avatar name={a.name} size="md" />
      <span className={cn('absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full border-2 border-surface',
        a.kind === 'CLUB' ? 'bg-xp text-bg' : 'bg-brand text-brand-fg')}>
        {a.kind === 'CLUB' ? <Shield className="size-3" aria-hidden /> : <User className="size-3" aria-hidden />}
      </span>
    </span>
  )
}
