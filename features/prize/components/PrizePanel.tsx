'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Gift, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, Field, Input, Sheet, Textarea } from '@/shared/ui'
import { downloadXlsx } from '@/shared/lib/excel'
import { cn } from '@/shared/lib/cn'
import {
  getPrize, listPrizeRecipients, prizeErrorMessage, prizeKeys, savePrizeAddress, setPrizeGift,
  type PrizeScope, type PrizeState,
} from '../api/prizeApi'
import { DEFAULT_SIZES, parseSizes, prizeSheet } from '../model/prize'

/** Tặng phẩm: người tham gia điền thông tin nhận; BTC khai báo + xem danh sách + xuất Excel. Tự ẩn nếu không liên quan. */
export function PrizePanel({ scope, refId, title }: { scope: PrizeScope; refId: string; title: string }) {
  const q = useQuery({ queryKey: prizeKeys(scope, refId), queryFn: () => getPrize(scope, refId), retry: false })
  const [form, setForm] = useState<'ADDR' | 'GIFT' | 'LIST' | null>(null)
  const s = q.data
  if (!s) return null
  if (!s.enabled && !s.can_manage) return null
  const close = () => setForm(null)
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><Gift className="size-4 text-coin" aria-hidden />Tặng phẩm</h2>
        {s.can_manage && <Button size="sm" variant="ghost" onClick={() => setForm('GIFT')}><Pencil className="size-4" aria-hidden />{s.enabled ? 'Sửa' : 'Khai báo'}</Button>}
      </div>
      {!s.enabled ? (
        <p className="text-sm text-fg-muted">Có tặng phẩm hiện vật? Khai báo để người tham gia điền họ tên, SĐT, địa chỉ (và cỡ áo) nhận quà.</p>
      ) : (
        <>
          <p className="whitespace-pre-line break-words text-sm font-medium">{s.description}</p>
          {s.deadline && <p className="text-xs text-fg-subtle">Hạn điền thông tin: {new Date(s.deadline).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })}{s.closed && ' (đã hết hạn)'}</p>}
          {s.is_member && <MyInfo s={s} onEdit={() => setForm('ADDR')} />}
          {s.can_manage && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
              <span className="text-sm text-fg-muted">{s.filled_count ?? 0} người đã điền</span>
              <Button size="sm" variant="secondary" onClick={() => setForm('LIST')}>Xem danh sách nhận</Button>
            </div>
          )}
        </>
      )}
      {form === 'ADDR' && <AddressSheet scope={scope} refId={refId} s={s} onClose={close} />}
      {form === 'GIFT' && <GiftSheet scope={scope} refId={refId} s={s} onClose={close} />}
      {form === 'LIST' && <ListSheet scope={scope} refId={refId} s={s} title={title} onClose={close} />}
    </Card>
  )
}

function MyInfo({ s, onEdit }: { s: PrizeState; onEdit: () => void }) {
  const m = s.mine
  if (!m) {
    return s.closed
      ? <p className="rounded-xl bg-surface-2 p-3 text-sm text-fg-muted">Bạn chưa điền thông tin nhận và đã hết hạn. Liên hệ Ban tổ chức.</p>
      : <div className="space-y-2 rounded-xl bg-coin/10 p-3"><p className="text-sm">Điền thông tin để Ban tổ chức gửi tặng phẩm cho bạn.</p><Button onClick={onEdit}>Điền thông tin nhận</Button></div>
  }
  return (
    <div className="space-y-1 rounded-xl border border-border p-3 text-sm">
      <p className="font-medium">{m.full_name} · {m.phone}</p>
      <p className="break-words text-fg-muted">{m.address}</p>
      {m.size && <p className="text-fg-muted">Cỡ áo: <b>{m.size}</b></p>}
      {m.note && <p className="text-fg-muted">Ghi chú: {m.note}</p>}
      {!s.closed && <Button size="sm" variant="secondary" onClick={onEdit}>Sửa thông tin</Button>}
    </div>
  )
}

function AddressSheet({ scope, refId, s, onClose }: { scope: PrizeScope; refId: string; s: PrizeState; onClose: () => void }) {
  const qc = useQueryClient()
  const m = s.mine
  const [f, setF] = useState({ full_name: m?.full_name ?? '', phone: m?.phone ?? '', address: m?.address ?? '', size: m?.size ?? '', note: m?.note ?? '' })
  const save = useMutation({
    mutationFn: () => savePrizeAddress(scope, refId, { ...f, size: f.size || null, note: f.note || null }),
    onSuccess: (d) => { toast.success('Đã lưu thông tin nhận tặng phẩm'); qc.setQueryData(prizeKeys(scope, refId), d); onClose() },
    onError: (e) => toast.error(prizeErrorMessage(e)),
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <Sheet open onClose={onClose} title="Thông tin nhận tặng phẩm" description="Chỉ Ban tổ chức xem được thông tin này, dùng để gửi tặng phẩm."
      footer={<Button block onClick={() => save.mutate()} loading={save.isPending}>Lưu thông tin</Button>}>
      <div className="space-y-4">
        <Field label="Họ tên người nhận" htmlFor="pz-name"><Input id="pz-name" value={f.full_name} maxLength={80} autoComplete="name" onChange={set('full_name')} /></Field>
        <Field label="Số điện thoại" htmlFor="pz-phone"><Input id="pz-phone" type="tel" inputMode="tel" value={f.phone} maxLength={16} autoComplete="tel" onChange={set('phone')} /></Field>
        <Field label="Địa chỉ nhận" htmlFor="pz-addr" hint="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành.">
          <Textarea id="pz-addr" value={f.address} maxLength={300} rows={3} autoComplete="street-address" onChange={set('address')} /></Field>
        {s.needs_size && (
          <div role="radiogroup" aria-label="Cỡ áo" className="space-y-1">
            <p className="text-sm font-medium text-fg-muted">Cỡ áo</p>
            <div className="flex flex-wrap gap-2">
              {(s.size_options ?? []).map((z) => (
                <button key={z} type="button" role="radio" aria-checked={f.size === z} onClick={() => setF({ ...f, size: z })}
                  className={cn('min-w-12 rounded-xl border px-3 py-2 text-sm font-medium', f.size === z ? 'border-coin/60 bg-coin/10' : 'border-border bg-surface')}>{z}</button>
              ))}
            </div>
          </div>
        )}
        <Field label="Ghi chú (không bắt buộc)" htmlFor="pz-note"><Input id="pz-note" value={f.note} maxLength={200} placeholder="VD: giao giờ hành chính" onChange={set('note')} /></Field>
      </div>
    </Sheet>
  )
}

function GiftSheet({ scope, refId, s, onClose }: { scope: PrizeScope; refId: string; s: PrizeState; onClose: () => void }) {
  const qc = useQueryClient()
  const [desc, setDesc] = useState(s.description ?? '')
  const [needs, setNeeds] = useState(!!s.needs_size)
  const [sizes, setSizes] = useState((s.size_options?.length ? s.size_options : DEFAULT_SIZES).join(', '))
  const [deadline, setDeadline] = useState(s.deadline ? toLocalInput(s.deadline) : '')
  const save = useMutation({
    mutationFn: () => setPrizeGift(scope, refId, desc.trim()
      ? { description: desc.trim(), needs_size: needs, size_options: needs ? parseSizes(sizes) : [], deadline: deadline ? new Date(deadline).toISOString() : null }
      : { description: '' }),
    onSuccess: () => { toast.success(desc.trim() ? 'Đã lưu tặng phẩm' : 'Đã gỡ khai báo tặng phẩm'); void qc.invalidateQueries({ queryKey: prizeKeys(scope, refId) }); onClose() },
    onError: (e) => toast.error(prizeErrorMessage(e)),
  })
  return (
    <Sheet open onClose={onClose} title="Khai báo tặng phẩm"
      description="Người tham gia sẽ được báo và điền thông tin nhận. Để trống mô tả = gỡ khai báo (thông tin đã điền được giữ)."
      footer={<Button block onClick={() => save.mutate()} loading={save.isPending}>Lưu</Button>}>
      <div className="space-y-4">
        <Field label="Tặng phẩm" htmlFor="pg-desc" hint="VD: Áo thun + huy chương cho người hoàn thành.">
          <Textarea id="pg-desc" value={desc} maxLength={500} rows={3} onChange={(e) => setDesc(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={needs} onChange={(e) => setNeeds(e.target.checked)} />Cần chọn cỡ áo</label>
        {needs && <Field label="Các cỡ áo" htmlFor="pg-sizes" hint="Cách nhau bằng dấu phẩy."><Input id="pg-sizes" value={sizes} onChange={(e) => setSizes(e.target.value)} /></Field>}
        <Field label="Hạn điền thông tin (không bắt buộc)" htmlFor="pg-dl"><Input id="pg-dl" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
      </div>
    </Sheet>
  )
}

function toLocalInput(iso: string) {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function ListSheet({ scope, refId, s, title, onClose }: { scope: PrizeScope; refId: string; s: PrizeState; title: string; onClose: () => void }) {
  const q = useQuery({ queryKey: [...prizeKeys(scope, refId), 'list'], queryFn: () => listPrizeRecipients(scope, refId) })
  const rows = q.data ?? []
  const exportXlsx = async () => {
    try { await downloadXlsx(`tang-pham-${title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}`, [prizeSheet(rows, !!s.needs_size, scope === 'RACE')]) }
    catch { toast.error('Không xuất được file Excel, thử lại.') }
  }
  return (
    <Sheet open onClose={onClose} title="Danh sách nhận tặng phẩm" description={`${rows.filter((r) => r.filled).length}/${rows.length} người đã điền`}
      footer={<Button block variant="secondary" onClick={exportXlsx} disabled={!rows.length}><Download className="size-4" aria-hidden />Xuất Excel</Button>}>
      {q.isLoading ? <p className="text-sm text-fg-muted">Đang tải…</p> : q.isError ? <p className="text-sm text-danger">{prizeErrorMessage(q.error)}</p> : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.user_id} className="rounded-xl border border-border p-3 text-sm">
              <p className="font-medium">{r.display_name}{r.ref_label && <span className="text-fg-subtle"> · {r.ref_label}</span>}</p>
              {r.filled ? (
                <>
                  <p>{r.full_name} · {r.phone}{s.needs_size && r.size ? ` · cỡ ${r.size}` : ''}</p>
                  <p className="break-words text-fg-muted">{r.address}</p>
                  {r.note && <p className="text-fg-muted">Ghi chú: {r.note}</p>}
                </>
              ) : <p className="text-fg-subtle">Chưa điền</p>}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
