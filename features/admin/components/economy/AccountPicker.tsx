'use client'

import { useState } from 'react'
import { Search, Shield, User, X } from 'lucide-react'
import { Avatar, Highlight, Input, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin } from '@/shared/lib/format'
import { useDebounced } from '@/shared/lib/search'
import type { AccountHit } from '../../api/adminApi'
import { useAccountSearch } from '../../hooks/useAdmin'

/** Tìm người dùng (tên, email, id) hoặc CLB (tên, id) để điều phối — ô tìm có gợi ý sổ xuống */
export function AccountPicker({ value, onChange, id }: { value: AccountHit | null; onChange: (a: AccountHit | null) => void; id: string }) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const q = useDebounced(text.trim(), 200)
  const search = useAccountSearch(q, open)
  const rows = search.data ?? []
  const pick = (a: AccountHit) => { onChange(a); setText(''); setOpen(false) }
  const listId = `${id}-list`

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

  const users = rows.filter((a) => a.kind === 'USER')
  const clubs = rows.filter((a) => a.kind === 'CLUB')
  const ordered = [...users, ...clubs]
  const option = (a: AccountHit) => {
    const i = ordered.indexOf(a)
    return (
      <button key={`${a.kind}-${a.id}`} id={`${listId}-${i}`} type="button" role="option" aria-selected={i === cursor}
        onMouseDown={(e) => e.preventDefault()} onClick={() => pick(a)} onMouseEnter={() => setCursor(i)}
        className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left', i === cursor && 'bg-surface-2')}>
        <AccountIcon a={a} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold"><Highlight text={a.name} query={q} /></span>
          <span className="block truncate text-xs text-fg-muted"><Highlight text={a.subtitle} query={q} /></span>
        </span>
        <span className="font-mono text-sm text-coin">{formatCoin(a.balance)}</span>
      </button>
    )
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-[22px] size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
      <Input id={id} value={text} className="pl-9" placeholder="Gõ tên, email người dùng, tên CLB hoặc ID" autoComplete="off"
        role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={open && ordered.length ? `${listId}-${cursor}` : undefined}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onChange={(e) => { setText(e.target.value); setCursor(0); setOpen(true) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setCursor((c) => Math.min(ordered.length - 1, c + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)) }
          else if (e.key === 'Enter' && open && ordered[cursor]) { e.preventDefault(); pick(ordered[cursor]) }
          else if (e.key === 'Escape') setOpen(false)
        }} />
      {open && (
        <div id={listId} role="listbox" aria-label="Gợi ý tài khoản"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border border-border bg-surface shadow-xl shadow-black/40">
          {search.isPending && !search.data ? (
            <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : search.isError ? (
            <p className="p-3 text-sm text-danger">Không tìm được: {(search.error as { message?: string })?.message || 'lỗi không rõ'}. Nếu vừa cập nhật app, hãy chạy migration 20261001003100 và 003300.</p>
          ) : !ordered.length ? (
            <p className="p-3 text-sm text-fg-muted">Không có tài khoản nào khớp “{q}”. Thử gõ không dấu, vài chữ trong tên hoặc email.</p>
          ) : (
            <div className={cn('transition-opacity', search.isPlaceholderData && 'opacity-60')}>
              {!q && <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Gợi ý</p>}
              {users.length > 0 && <p className="px-3 pt-2 text-[11px] font-semibold text-fg-subtle">Người dùng</p>}
              {users.map(option)}
              {clubs.length > 0 && <p className="border-t border-border px-3 pt-2 text-[11px] font-semibold text-fg-subtle">Quỹ CLB</p>}
              {clubs.map(option)}
            </div>
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
