'use client'

import { useState } from 'react'
import { Check, Coins, Palette, Shirt, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Field, Input, SegmentedControl, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatRelative } from '@/shared/lib/format'
import { PaperDoll, RARITY_META, uniformPreview, type Rarity, type UniformRequest, type UniformStatus } from '@/features/character'
import { adminErrorMessage } from '../../api/adminApi'
import { useAvatarCollections, useReviewUniform, useUniformRequests } from '../../hooks/useAdmin'
import { ItemEditor } from './ItemEditor'

const FILTERS: { value: UniformStatus | 'ALL'; label: string }[] = [
  { value: 'PENDING', label: 'Chờ duyệt' }, { value: 'APPROVED', label: 'Đã duyệt' }, { value: 'REJECTED', label: 'Từ chối' }, { value: 'ALL', label: 'Tất cả' },
]
const RARITIES = Object.keys(RARITY_META) as Rarity[]

/** Duyệt đồng phục CLB: xem thử trên nhân vật, đặt giá như vật phẩm thường, hoặc trả lại kèm lý do */
export function UniformReviewPanel() {
  const [status, setStatus] = useState<UniformStatus | 'ALL'>('PENDING')
  const q = useUniformRequests(status)
  const [approving, setApproving] = useState<UniformRequest | null>(null)
  const [rejecting, setRejecting] = useState<UniformRequest | null>(null)
  const [designing, setDesigning] = useState(false)
  return (
    <div className="space-y-3">
      <Card className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand"><Palette className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Thiết kế đồng phục</p>
          <p className="text-xs text-fg-muted">Admin tự thiết kế cho một CLB, hoặc duyệt mẫu CLB gửi (Cài đặt CLB › Đồng phục CLB)</p>
        </div>
        <Button onClick={() => setDesigning(true)} className="shrink-0"><Shirt className="size-4" aria-hidden />Thiết kế</Button>
      </Card>
      <p className="rounded-xl bg-surface-2 p-3 text-xs text-fg-muted">
        Đồng phục là vật phẩm áo thường, chỉ thành viên CLB mua / mặc. Giá do admin đặt; 0 Xu = phát miễn phí cho cả CLB.
        Áo thật do Shop đối tác bán ở Chợ Runner — RaceHub không nhận tiền.
      </p>
      <SegmentedControl value={status} onChange={setStatus} options={FILTERS} />
      {q.isPending ? <Skeleton className="h-48" /> : q.isError ? (
        <ErrorState message={adminErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={Shirt} title="Không có yêu cầu" description="Ban quản trị CLB gửi mẫu ở Cài đặt CLB › Đồng phục CLB." />
      ) : (
        <ul className="space-y-3">
          {q.data!.map((r) => (
            <li key={r.id}>
              <Card className="flex gap-3 p-3">
                <div className="h-44 w-32 shrink-0 overflow-hidden rounded-xl bg-[#c4c4ce]">
                  <PaperDoll gender="male" items={[uniformPreview(r.name, r.color, r.print)]} personalName="Runner" className="size-full" label={`Mẫu ${r.name}`} />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm font-semibold">{r.name}</p>
                  <p className="truncate text-xs text-fg-muted">{r.club_name} · {r.requested_by_name ?? '—'} · {formatRelative(r.created_at)}</p>
                  <p className="text-xs text-fg-muted">
                    <span className="mr-1 inline-block size-3 rounded-sm align-middle" style={{ background: r.color }} aria-hidden />{r.color}
                    {r.print.title && ` · “${r.print.title}”`}{r.print.personal === 'NAME' && ' · tên runner'}{r.print.logo_url && ' · có logo'}
                  </p>
                  {r.note && <p className="line-clamp-3 text-xs">Ghi chú: {r.note}</p>}
                  {r.review_note && <p className="text-xs text-danger">Admin: {r.review_note}</p>}
                  {r.item && (
                    <p className="flex items-center gap-2 text-xs text-fg-muted">
                      <span className="font-mono">{r.item.code}</span>
                      <span className="flex items-center gap-0.5 text-coin"><Coins className="size-3" aria-hidden />{formatCoin(Number(r.item.price_xu))}</span>
                      <span className="flex items-center gap-0.5"><Users className="size-3" aria-hidden />{r.item.owners ?? 0}</span>
                    </p>
                  )}
                  {r.status === 'PENDING' ? (
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" onClick={() => setApproving(r)}><Check className="size-4" aria-hidden />Duyệt</Button>
                      <Button size="sm" variant="secondary" onClick={() => setRejecting(r)}><X className="size-4" aria-hidden />Trả lại</Button>
                    </div>
                  ) : status === 'ALL' && <p className="text-xs font-semibold text-fg-muted">{FILTERS.find((f) => f.value === r.status)?.label ?? 'Đã hủy'}</p>}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {approving && <ApproveSheet r={approving} onClose={() => setApproving(null)} />}
      {rejecting && <RejectSheet r={rejecting} onClose={() => setRejecting(null)} />}
      {designing && <ItemEditor item={null} preset="uniform" onClose={() => setDesigning(false)} />}
    </div>
  )
}

function ApproveSheet({ r, onClose }: { r: UniformRequest; onClose: () => void }) {
  const [name, setName] = useState(r.name)
  const [price, setPrice] = useState('0')
  const [rarity, setRarity] = useState<Rarity>('rare')
  const [collection, setCollection] = useState('')
  const [note, setNote] = useState('')
  const collections = useAvatarCollections()
  const review = useReviewUniform()
  const priceNum = Number(price)
  const ok = name.trim().length >= 2 && Number.isFinite(priceNum) && priceNum >= 0 && priceNum <= 100000
  const submit = () => review.mutate(
    { id: r.id, action: 'APPROVE', p: { name: name.trim(), price_xu: priceNum, rarity, collection: collection || null, note: note.trim() || undefined } },
    { onSuccess: () => { toast.success(`Đã duyệt ${name.trim()}`, { description: 'Thành viên CLB được báo có đồng phục mới.' }); onClose() },
      onError: (e) => toast.error(adminErrorMessage(e)) },
  )
  return (
    <Sheet open onClose={onClose} title={`Duyệt: ${r.name}`} description={r.club_name ?? undefined}
      footer={<div className="flex gap-2"><Button variant="secondary" block onClick={onClose}>Hủy</Button><Button block onClick={submit} loading={review.isPending} disabled={!ok}>Duyệt & lên Tủ đồ</Button></div>}>
      <div className="space-y-4">
        <Field label="Tên vật phẩm" htmlFor="ua-name"><Input id="ua-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Giá (Xu)" htmlFor="ua-price" hint="0 = phát miễn phí cho mọi thành viên CLB">
          <Input id="ua-price" type="number" inputMode="decimal" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label="Độ hiếm">
          <div className="grid grid-cols-4 gap-1.5">
            {RARITIES.map((x) => (
              <button key={x} type="button" onClick={() => setRarity(x)} aria-pressed={rarity === x}
                className={cn('h-10 rounded-xl border text-xs font-semibold', RARITY_META[x].text, rarity === x ? 'border-brand bg-brand/10' : 'border-border')}>
                {RARITY_META[x].label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Bộ sưu tập" htmlFor="ua-col">
          <select id="ua-col" value={collection} onChange={(e) => setCollection(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px]">
            <option value="">Không thuộc bộ nào</option>
            {(collections.data ?? []).filter((c) => c.is_active).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Lời nhắn cho CLB (không bắt buộc)" htmlFor="ua-note"><Textarea id="ua-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Sheet>
  )
}

function RejectSheet({ r, onClose }: { r: UniformRequest; onClose: () => void }) {
  const [note, setNote] = useState('')
  const review = useReviewUniform()
  const submit = () => review.mutate(
    { id: r.id, action: 'REJECT', p: { note: note.trim() } },
    { onSuccess: () => { toast.success('Đã trả lại mẫu cho CLB'); onClose() }, onError: (e) => toast.error(adminErrorMessage(e)) },
  )
  return (
    <Sheet open onClose={onClose} title={`Trả lại: ${r.name}`} description="CLB nhận thông báo kèm lý do để sửa và gửi lại"
      footer={<div className="flex gap-2"><Button variant="secondary" block onClick={onClose}>Hủy</Button><Button variant="danger" block onClick={submit} loading={review.isPending} disabled={note.trim().length < 3}>Trả lại</Button></div>}>
      <Field label="Lý do" htmlFor="ur-note" hint={`${note.length}/300`}>
        <Textarea id="ur-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Logo bị mờ, chữ quá dài…" />
      </Field>
    </Sheet>
  )
}
