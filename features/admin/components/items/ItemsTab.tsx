'use client'

import { useMemo, useState } from 'react'
import { Coins, Pencil, Plus, Search, Shirt, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Input, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { matchesSearch } from '@/shared/lib/search'
import { formatCoin } from '@/shared/lib/format'
import { LayerThumb, RARITY_META, SLOTS, type ItemLifecycle, type Slot } from '@/features/character'
import { adminErrorMessage, ITEM_STATUS, type AdminItem } from '../../api/adminApi'
import { useAvatarItems, useSetItemStatus, useUniformRequests } from '../../hooks/useAdmin'
import { CollectionsPanel } from './CollectionsPanel'
import { ItemEditor } from './ItemEditor'
import { UniformReviewPanel } from './UniformReviewPanel'

type Filter = 'all' | 'draft' | 'archived' | 'retired' | Slot
type Pane = 'items' | 'collections' | 'uniforms'

const STATUS_FILTER: Record<'all' | 'draft' | 'archived' | 'retired', (s: ItemLifecycle) => boolean> = {
  all: (s) => s === 'PUBLISHED', draft: (s) => s === 'DRAFT' || s === 'REVIEW', archived: (s) => s === 'ARCHIVED', retired: (s) => s === 'RETIRED',
}

/** Quản lý trang phục: vật phẩm (vòng đời, điều kiện, vùng in), bộ sưu tập, duyệt đồng phục CLB */
export function ItemsTab() {
  const [pane, setPane] = useState<Pane>('items')
  const pending = useUniformRequests('PENDING')
  const n = pending.data?.length ?? 0
  return (
    <div className="space-y-3">
      <SegmentedControl value={pane} onChange={setPane} options={[
        { value: 'items', label: 'Vật phẩm' }, { value: 'collections', label: 'Bộ sưu tập' },
        { value: 'uniforms', label: 'Đồng phục', ...(n > 0 ? { count: n } : {}) },
      ]} />
      {pane === 'items' ? <ItemsPane /> : pane === 'collections' ? <CollectionsPanel /> : <UniformReviewPanel />}
    </div>
  )
}

function ItemsPane() {
  const q = useAvatarItems()
  const toggle = useSetItemStatus()
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<AdminItem | 'new' | null>(null)

  const items = useMemo(() => q.data ?? [], [q.data])
  const slots = SLOTS.filter((s) => items.some((i) => i.slot === s.slot))
  const shown = items.filter((i) =>
    (filter in STATUS_FILTER ? STATUS_FILTER[filter as keyof typeof STATUS_FILTER](i.status) : i.slot === filter && i.status === 'PUBLISHED')
    && matchesSearch(search, i.name, i.code, i.club_name ?? '', i.collection ?? ''))
  const count = (k: keyof typeof STATUS_FILTER) => items.filter((i) => STATUS_FILTER[k](i.status)).length

  const setActive = async (it: AdminItem, active: boolean) => {
    try {
      await toggle.mutateAsync({ code: it.code, status: active ? 'PUBLISHED' : 'ARCHIVED' })
      toast.success(active ? `Đã mở bán ${it.name}` : `Đã ngừng bán ${it.name} (người đã có vẫn mặc được)`)
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
          <p className="text-xs text-fg-muted">{count('all')} đang bán · {count('draft')} nháp · {count('archived') + count('retired')} ngừng / gỡ</p>
        </div>
        <Button onClick={() => setEditing('new')} className="shrink-0"><Plus className="size-4" aria-hidden />Thêm</Button>
      </Card>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm theo tên hoặc mã" className="pl-9" aria-label="Tìm vật phẩm" />
      </div>
      <nav className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" aria-label="Lọc vật phẩm">
        {[{ key: 'all' as Filter, label: 'Đang bán' }, ...slots.map((s) => ({ key: s.slot as Filter, label: s.label })),
          { key: 'draft' as Filter, label: `Nháp · ${count('draft')}` }, { key: 'archived' as Filter, label: 'Ngừng bán' }, { key: 'retired' as Filter, label: 'Gỡ hẳn' }].map((f) => (
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
        <ErrorState message={adminErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState icon={Shirt} title="Không có vật phẩm" description={search ? 'Thử từ khóa khác.' : 'Bấm Thêm để đưa món mới lên shop.'} />
      ) : (
        <ul className="space-y-2">
          {shown.map((it) => {
            const slot = SLOTS.find((s) => s.slot === it.slot)
            const layer = it.layer_urls?.male ?? it.layer_urls?.female ?? null
            return (
              <li key={it.code}>
                <Card className={cn('flex items-center gap-3 p-3', it.status !== 'PUBLISHED' && 'opacity-70')}>
                  <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-border"
                    style={{ background: layer ? 'var(--color-surface-2)' : it.color ?? 'repeating-linear-gradient(135deg, var(--color-surface-2) 0 6px, var(--color-border) 6px 12px)' }}>
                    {layer ? (
                      <LayerThumb src={layer} gender={it.layer_urls?.male ? 'male' : 'female'} className="size-full" />
                    ) : !it.color ? <span className="text-xs font-bold text-fg-muted">Gốc</span> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold">{it.name}</span>
                      {it.status !== 'PUBLISHED' && <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold', ITEM_STATUS[it.status].tone)}>{ITEM_STATUS[it.status].label}</span>}
                      {it.club_id && <span className="shrink-0 truncate rounded-full bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand">CLB {it.club_name}</span>}
                    </p>
                    <p className="truncate font-mono text-xs text-fg-subtle">{it.code}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
                      <span>{slot?.label}</span>
                      <span className={RARITY_META[it.rarity].text}>{RARITY_META[it.rarity].label}</span>
                      {it.price_xu > 0
                        ? <span className="flex items-center gap-0.5 font-mono text-coin"><Coins className="size-3" aria-hidden />{formatCoin(it.price_xu)}</span>
                        : <span>{it.unlock_level > 1 ? `Quà cấp ${it.unlock_level}` : 'Miễn phí'}</span>}
                      <span className="flex items-center gap-0.5"><Users className="size-3" aria-hidden />{it.owners}{it.supply_limit ? `/${it.supply_limit}` : ''}</span>
                      {it.collection && <span className="truncate">#{it.collection}</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(it)} aria-label={`Sửa ${it.name}`}>
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button size="sm" variant={it.status === 'PUBLISHED' ? 'secondary' : 'primary'} disabled={toggle.isPending}
                      onClick={() => void setActive(it, it.status !== 'PUBLISHED')}>
                      {it.status === 'PUBLISHED' ? 'Ngừng' : 'Bán'}
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
