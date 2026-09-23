'use client'

import { useMemo, useState } from 'react'
import { Coins, Pencil, Plus, Search, Shirt, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Input, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin } from '@/shared/lib/format'
import { LayerThumb, RARITY_META, SLOTS, type Slot } from '@/features/character'
import { adminErrorMessage, type AdminItem } from '../../api/adminApi'
import { useAvatarItems, useSetItemActive } from '../../hooks/useAdmin'
import { ItemEditor } from './ItemEditor'

type Filter = 'all' | 'hidden' | Slot

/** Danh mục vật phẩm nhân vật: thêm món mới (màu hoặc lớp ảnh), sửa, bán / ngừng bán */
export function ItemsTab() {
  const q = useAvatarItems()
  const toggle = useSetItemActive()
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<AdminItem | 'new' | null>(null)

  const items = useMemo(() => q.data ?? [], [q.data])
  const slots = SLOTS.filter((s) => items.some((i) => i.slot === s.slot))
  const shown = items.filter((i) =>
    (filter === 'all' ? i.is_active : filter === 'hidden' ? !i.is_active : i.slot === filter && i.is_active)
    && (!search.trim() || `${i.name} ${i.code}`.toLowerCase().includes(search.trim().toLowerCase())))

  const setActive = async (it: AdminItem, active: boolean) => {
    try {
      await toggle.mutateAsync({ code: it.code, active })
      toast.success(active ? `Đã mở bán ${it.name}` : `Đã ngừng bán ${it.name}`)
    } catch (e) {
      toast.error(adminErrorMessage(e))
    }
  }

  return (
    <div className="space-y-3">
      <Card className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand"><Shirt className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Vật phẩm nhân vật</p>
          <p className="text-xs text-fg-muted">{items.filter((i) => i.is_active).length} đang bán · {items.filter((i) => !i.is_active).length} đang ẩn</p>
        </div>
        <Button onClick={() => setEditing('new')} className="shrink-0"><Plus className="size-4" aria-hidden />Thêm</Button>
      </Card>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm theo tên hoặc mã" className="pl-9" aria-label="Tìm vật phẩm" />
      </div>
      <nav className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" aria-label="Lọc vật phẩm">
        {[{ key: 'all' as Filter, label: 'Đang bán' }, ...slots.map((s) => ({ key: s.slot as Filter, label: s.label })), { key: 'hidden' as Filter, label: 'Đang ẩn' }].map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
            className={cn('shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold',
              filter === f.key ? 'border-brand bg-brand text-brand-fg' : 'border-border text-fg-muted')}>
            {f.label}
          </button>
        ))}
      </nav>

      {q.isPending ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((k) => <Skeleton key={k} className="h-16" />)}</div>
      ) : q.isError ? (
        <ErrorState message={adminErrorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState icon={Shirt} title="Không có vật phẩm" description={search ? 'Thử từ khóa khác.' : 'Bấm Thêm để đưa món mới lên shop.'} />
      ) : (
        <ul className="space-y-2">
          {shown.map((it) => {
            const slot = SLOTS.find((s) => s.slot === it.slot)
            const layer = it.layer_urls?.male ?? it.layer_urls?.female ?? null
            return (
              <li key={it.code}>
                <Card className={cn('flex items-center gap-3 p-3', !it.is_active && 'opacity-70')}>
                  <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-border"
                    style={{ background: layer ? 'var(--color-surface-2)' : it.color ?? 'repeating-linear-gradient(135deg, var(--color-surface-2) 0 6px, var(--color-border) 6px 12px)' }}>
                    {layer ? (
                      <LayerThumb src={layer} gender={it.layer_urls?.male ? 'male' : 'female'} className="size-full" />
                    ) : !it.color ? <span className="text-xs font-bold text-fg-muted">Gốc</span> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{it.name}</p>
                    <p className="truncate font-mono text-xs text-fg-subtle">{it.code}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
                      <span>{slot?.label}</span>
                      <span className={RARITY_META[it.rarity].text}>{RARITY_META[it.rarity].label}</span>
                      {it.price_xu > 0
                        ? <span className="flex items-center gap-0.5 font-mono text-coin"><Coins className="size-3" aria-hidden />{formatCoin(it.price_xu)}</span>
                        : <span>{it.unlock_level > 1 ? `Quà cấp ${it.unlock_level}` : 'Miễn phí'}</span>}
                      <span className="flex items-center gap-0.5"><Users className="size-3" aria-hidden />{it.owners}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(it)} aria-label={`Sửa ${it.name}`}>
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button size="sm" variant={it.is_active ? 'secondary' : 'primary'} disabled={toggle.isPending}
                      onClick={() => void setActive(it, !it.is_active)}>
                      {it.is_active ? 'Ẩn' : 'Bán'}
                    </Button>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      {editing && <ItemEditor item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
