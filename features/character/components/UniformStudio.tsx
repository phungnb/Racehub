'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Coins, Plus, Shirt, Store, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ConfirmSheet, Field, Input, SectionTitle, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatRelative } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { useMyProfile } from '@/features/auth'
import {
  cancelUniformRequest, listClubUniforms, requestClubUniform, uniformErrorMessage, uploadPrintLogo,
  type UniformRequest, type UniformStatus,
} from '../api/uniformApi'
import type { CharacterItem, ItemPrint } from '../model/catalog'
import { defaultKit, kitFromRequest, kitParts, type KitDesign } from '../model/kit'
import { KitStudio } from './KitStudio'
import { hasPrint } from './PrintFields'

const STATUS: Record<UniformStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Chờ duyệt', tone: 'bg-coin/15 text-coin' },
  APPROVED: { label: 'Đã lên Tủ đồ', tone: 'bg-brand/15 text-brand' },
  REJECTED: { label: 'Cần chỉnh', tone: 'bg-danger/15 text-danger' },
  CANCELLED: { label: 'Đã hủy', tone: 'bg-surface-2 text-fg-muted' },
}

/** Áo nhân vật để xem thử: áo TINT theo màu + nội dung in */
export const uniformPreview = (name: string, color: string, print: ItemPrint | null): CharacterItem => ({
  code: 'uniform_preview', name, description: null, slot: 'top', rarity: 'rare', render_kind: 'TINT', layer_urls: null,
  color, price_xu: 0, unlock_level: 1, is_default: false, print,
})

const uniformKey = (clubId: string) => ['club', clubId, 'uniforms'] as const

/** Cài đặt CLB › Đồng phục: ban quản trị thiết kế áo nhân vật (màu, logo, chữ) và gửi admin duyệt */
export function UniformSection({ clubId, clubName, accent, logoUrl }: { clubId: string; clubName: string; accent?: string | null; logoUrl?: string | null }) {
  const q = useQuery({ queryKey: uniformKey(clubId), queryFn: () => listClubUniforms(clubId) })
  const [designing, setDesigning] = useState<UniformRequest | 'new' | null>(null)
  const [cancelling, setCancelling] = useState<UniformRequest | null>(null)
  const qc = useQueryClient()
  const cancel = useMutation({
    mutationFn: (id: string) => cancelUniformRequest(id),
    onSuccess: () => { toast.success('Đã hủy yêu cầu'); void qc.invalidateQueries({ queryKey: uniformKey(clubId) }) },
    onError: (e) => toast.error(uniformErrorMessage(e)),
  })
  const list = q.data ?? []
  const pending = list.filter((r) => r.status === 'PENDING').length

  return (
    <section>
      <SectionTitle>Đồng phục CLB</SectionTitle>
      <Card className="space-y-3">
        <p className="text-sm text-fg-muted">
          Thiết kế cả bộ đồng phục cho nhân vật của thành viên: áo, quần, tất, giày theo màu CLB (hút màu từ ảnh áo thật / logo), họa tiết, logo, tên từng runner. Admin duyệt và đặt giá như vật phẩm thường;
          chỉ thành viên CLB mua và mặc được.
        </p>
        <p className="flex items-start gap-2 rounded-xl bg-surface-2 p-2.5 text-xs text-fg-muted">
          <Store className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>Áo thật chỉ bán qua Shop đối tác ở <Link href={routes.market} className="font-semibold text-brand">Chợ Runner</Link>. RaceHub không nhận tiền áo.</span>
        </p>

        {q.isPending ? <Skeleton className="h-20" /> : q.isError ? (
          <p className="text-sm text-danger">{uniformErrorMessage(q.error)}</p>
        ) : list.length > 0 && (
          <ul className="space-y-2">
            {list.map((r) => (
              <li key={r.id} className="flex items-start gap-3 rounded-xl border border-border p-2.5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 flex-col overflow-hidden rounded-lg border border-border" aria-hidden>
                  <span className="flex-[3]" style={{ background: r.color }} />
                  <span className="flex flex-[2]">
                    {(['bottom', 'socks', 'shoes'] as const).map((k) => <span key={k} className="flex-1" style={{ background: r.parts?.[k]?.color ?? r.color }} />)}
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{r.name}</span>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS[r.status].tone)}>{STATUS[r.status].label}</span>
                  </p>
                  <p className="text-xs text-fg-muted">
                    {r.requested_by_name ?? 'Ban quản trị'} · {formatRelative(r.created_at)}
                    {r.item && <> · <Coins className="inline size-3" aria-hidden /> {r.item.price_xu > 0 ? `${formatCoin(Number(r.item.price_xu))} Xu` : 'Miễn phí'}
                      {r.item.owners != null && <> · <Users className="inline size-3" aria-hidden /> {r.item.owners}</>}</>}
                  </p>
                  {r.review_note && <p className="mt-1 text-xs text-fg">Admin: {r.review_note}</p>}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  {r.status === 'REJECTED' && <Button size="sm" variant="secondary" onClick={() => setDesigning(r)}>Sửa gửi lại</Button>}
                  {r.status === 'PENDING' && (
                    <Button size="sm" variant="ghost" onClick={() => setCancelling(r)} aria-label={`Hủy ${r.name}`}><X className="size-4" aria-hidden /></Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button block variant="secondary" onClick={() => setDesigning('new')} disabled={pending >= 3}>
          <Plus className="size-4" aria-hidden />{pending >= 3 ? 'Đang có 3 mẫu chờ duyệt' : 'Thiết kế bộ đồng phục'}
        </Button>
      </Card>

      {designing && (
        <UniformDesigner clubId={clubId} clubName={clubName} accent={accent} logoUrl={logoUrl} from={designing === 'new' ? null : designing}
          onClose={() => setDesigning(null)} />
      )}
      <ConfirmSheet open={!!cancelling} onClose={() => setCancelling(null)} loading={cancel.isPending}
        onConfirm={() => { if (cancelling) cancel.mutate(cancelling.id, { onSettled: () => setCancelling(null) }) }}
        title={cancelling ? `Hủy mẫu "${cancelling.name}"?` : ''} confirmLabel="Hủy yêu cầu" />
    </section>
  )
}

function UniformDesigner({ clubId, clubName, accent, logoUrl, from, onClose }: {
  clubId: string; clubName: string; accent?: string | null; logoUrl?: string | null; from: UniformRequest | null; onClose: () => void
}) {
  const { profile } = useMyProfile()
  const [name, setName] = useState(from?.name ?? `Đồng phục ${clubName}`.slice(0, 60))
  const [kit, setKit] = useState<KitDesign>(() => (from ? kitFromRequest(from) : defaultKit(clubName, accent)))
  const [note, setNote] = useState('')
  const [uploading, setUploading] = useState(false)
  const qc = useQueryClient()
  const send = useMutation({
    mutationFn: () => requestClubUniform(clubId, { name: name.trim(), color: kit.top, print: kit.print, parts: kitParts(kit), note: note.trim() || null }),
    onSuccess: () => {
      toast.success('Đã gửi bộ đồng phục', { description: 'Admin sẽ duyệt và đặt giá. Bạn nhận thông báo khi có kết quả.' })
      void qc.invalidateQueries({ queryKey: uniformKey(clubId) })
      onClose()
    },
    onError: (e) => toast.error(uniformErrorMessage(e)),
  })
  const ok = name.trim().length >= 2 && hasPrint(kit.print)

  return (
    <Sheet open onClose={onClose} title="Thiết kế đồng phục" description="Cả bộ áo, quần, tất, giày — xem thử trên nhân vật trước khi gửi duyệt"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onClose}>Đóng</Button>
          <Button block onClick={() => send.mutate()} loading={send.isPending} disabled={!ok || uploading}><Shirt className="size-4" aria-hidden />Gửi duyệt</Button>
        </div>
      }>
      <div className="space-y-4">
        <Field label="Tên bộ đồng phục" htmlFor="uni-name">
          <Input id="uni-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <KitStudio value={kit} onChange={setKit} upload={(f) => uploadPrintLogo(clubId, f)} clubLogoUrl={logoUrl}
          personalName={profile?.display_name} onUploading={setUploading} gender={profile?.gender === 'female' ? 'female' : 'male'} />
        {!hasPrint(kit.print) && <p className="text-xs text-danger">Áo cần ít nhất logo, chữ hoặc tên runner (thẻ In áo).</p>}
        <Field label="Ghi chú cho admin (không bắt buộc)" htmlFor="uni-note" hint={`${note.length}/500`}>
          <Textarea id="uni-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Muốn bán giá mềm cho thành viên mới…" />
        </Field>
      </div>
    </Sheet>
  )
}
