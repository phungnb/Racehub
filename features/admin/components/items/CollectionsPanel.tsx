'use client'

import { useState } from 'react'
import { Layers, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Field, Input, Sheet, Skeleton, SwitchRow, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { adminErrorMessage, COLLECTION_KIND, type AvatarCollection, type CollectionKind } from '../../api/adminApi'
import { useAvatarCollections, useSaveAvatarCollection } from '../../hooks/useAdmin'
import { fromLocalInput, toLocalInput } from './ItemRules'

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('vi-VN') : '')

/** Bộ sưu tập: nhóm vật phẩm theo mùa / sự kiện / CLB / nhà tài trợ; người chơi lọc theo bộ trong Tủ đồ */
export function CollectionsPanel() {
  const q = useAvatarCollections()
  const [editing, setEditing] = useState<AvatarCollection | 'new' | null>(null)
  return (
    <div className="space-y-3">
      <Card className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-xp/15 text-xp"><Layers className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Bộ sưu tập</p>
          <p className="text-xs text-fg-muted">Gắn vật phẩm vào bộ ở màn sửa vật phẩm. Bộ hết hạn tự ẩn khỏi Tủ đồ.</p>
        </div>
        <Button onClick={() => setEditing('new')} className="shrink-0"><Plus className="size-4" aria-hidden />Thêm</Button>
      </Card>
      {q.isPending ? <Skeleton className="h-32" /> : q.isError ? (
        <ErrorState message={adminErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={Layers} title="Chưa có bộ sưu tập" description="Ví dụ: Mùa hè 2026, Giải Tết, Đồng phục nhà tài trợ." />
      ) : (
        <ul className="space-y-2">
          {q.data!.map((c) => (
            <li key={c.code}>
              <Card className={cn('flex items-center gap-3 p-3', !c.is_active && 'opacity-60')}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{c.name}</p>
                  <p className="truncate text-xs text-fg-muted">
                    <span className="font-mono">{c.code}</span> · {COLLECTION_KIND[c.kind]} · {c.items ?? 0} món
                    {(c.starts_at || c.ends_at) && ` · ${fmt(c.starts_at) || '…'} → ${fmt(c.ends_at) || '…'}`}
                    {!c.is_active && ' · đã tắt'}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setEditing(c)} aria-label={`Sửa ${c.name}`}><Pencil className="size-4" aria-hidden /></Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editing && <CollectionEditor c={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function CollectionEditor({ c, onClose }: { c: AvatarCollection | null; onClose: () => void }) {
  const [code, setCode] = useState(c?.code ?? '')
  const [name, setName] = useState(c?.name ?? '')
  const [desc, setDesc] = useState(c?.description ?? '')
  const [kind, setKind] = useState<CollectionKind>(c?.kind ?? 'SEASON')
  const [start, setStart] = useState(toLocalInput(c?.starts_at))
  const [end, setEnd] = useState(toLocalInput(c?.ends_at))
  const [active, setActive] = useState(c?.is_active ?? true)
  const save = useSaveAvatarCollection()
  const ok = /^[a-z0-9_]{3,40}$/.test(code) && name.trim().length >= 2 && !(start && end && end <= start)

  const submit = () => save.mutate(
    { code, name: name.trim(), description: desc.trim() || null, kind, starts_at: fromLocalInput(start), ends_at: fromLocalInput(end), sort: c?.sort ?? 100, is_active: active },
    { onSuccess: () => { toast.success('Đã lưu bộ sưu tập'); onClose() }, onError: (e) => toast.error(adminErrorMessage(e)) },
  )

  return (
    <Sheet open onClose={onClose} title={c ? `Sửa: ${c.name}` : 'Thêm bộ sưu tập'}
      footer={<div className="flex gap-2"><Button variant="secondary" block onClick={onClose}>Hủy</Button><Button block onClick={submit} loading={save.isPending} disabled={!ok}>Lưu</Button></div>}>
      <div className="space-y-4">
        <Field label="Tên" htmlFor="col-name"><Input id="col-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Mùa hè 2026" /></Field>
        <Field label="Mã" htmlFor="col-code" hint={c ? 'Mã cố định' : 'Chữ thường không dấu, số, _ (3–40 ký tự)'}>
          <Input id="col-code" value={code} disabled={!!c} className="font-mono" onChange={(e) => setCode(e.target.value.toLowerCase())} placeholder="summer_2026" />
        </Field>
        <Field label="Mô tả" htmlFor="col-desc" hint={`${desc.length}/200`}><Textarea id="col-desc" value={desc} maxLength={200} onChange={(e) => setDesc(e.target.value)} /></Field>
        <Field label="Loại">
          <div className="grid grid-cols-3 gap-1.5">
            {(Object.keys(COLLECTION_KIND) as CollectionKind[]).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
                className={cn('h-10 rounded-xl border text-xs font-semibold', kind === k ? 'border-brand bg-brand/10 text-fg' : 'border-border text-fg-muted')}>
                {COLLECTION_KIND[k]}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bắt đầu" htmlFor="col-start"><Input id="col-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Kết thúc" htmlFor="col-end"><Input id="col-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <SwitchRow checked={active} onChange={setActive} label="Hiện trong Tủ đồ" description="Tắt để ẩn nút lọc bộ này (vật phẩm vẫn bán theo trạng thái riêng)" />
      </div>
    </Sheet>
  )
}
