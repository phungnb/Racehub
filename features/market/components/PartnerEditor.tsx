'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ExternalLink, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ErrorState, Field, Input, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { PROVINCES } from '@/shared/lib/provinces'
import { ImagePick } from '@/shared/design/studio/bits'
import {
  marketErrorMessage, myPartners, PARTNER_KIND, savePartner, uploadPartnerImage,
  type Partner, type PartnerContacts, type PartnerInput, type PartnerKind, type PartnerService,
} from '../api/marketApi'
import { KIND_ICON, VerifiedBadge } from './PartnerBits'

const STATUS: Record<Partner['status'], { label: string; tone: string }> = {
  PENDING: { label: 'Đang chờ xác minh', tone: 'bg-coin/15 text-coin' },
  APPROVED: { label: 'Đang hiện trên Chợ', tone: 'bg-brand/15 text-brand' },
  REJECTED: { label: 'Cần bổ sung', tone: 'bg-danger/15 text-danger' },
  HIDDEN: { label: 'Đang bị ẩn', tone: 'bg-surface-2 text-fg-muted' },
}
const KINDS = Object.keys(PARTNER_KIND) as PartnerKind[]

/** Đăng ký / sửa hồ sơ đối tác của chính mình (mỗi người tối đa 1 hồ sơ cho mỗi loại) */
export function PartnerEditor() {
  const q = useQuery({ queryKey: ['market', 'mine'], queryFn: myPartners })
  const [edit, setEdit] = useState<Partner | PartnerKind | null>(null)
  const back = <Link href={routes.market} className="inline-flex items-center gap-1 text-sm text-fg-muted"><ChevronLeft className="size-4" aria-hidden />Chợ Runner</Link>
  if (edit) return <div className="space-y-4">{back}<PartnerForm key={typeof edit === 'string' ? edit : edit.id} init={edit} onDone={() => setEdit(null)} /></div>
  const mine = q.data ?? []
  const free = KINDS.filter((k) => !mine.some((p) => p.kind === k))
  return (
    <div className="space-y-4 animate-fade-in">
      {back}
      <header>
        <h1 className="text-2xl font-bold">Hồ sơ đối tác của tôi</h1>
        <p className="text-sm text-fg-muted">Bạn là HLV, có cửa hàng hay dịch vụ cho runner? Đăng ký hồ sơ — RaceHub xác minh rồi hiện trên Chợ Runner. Không mất phí, RaceHub không thu tiền hộ.</p>
      </header>
      {q.isPending ? <Skeleton className="h-32" /> : q.isError ? <ErrorState message={marketErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          {mine.map((p) => (
            <Card key={p.id} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{p.name}</p>
                <span className="text-xs text-fg-muted">· {PARTNER_KIND[p.kind].label}</span>
                {p.verified && p.status === 'APPROVED' ? <VerifiedBadge /> : <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', STATUS[p.status].tone)}>{STATUS[p.status].label}</span>}
              </div>
              {p.review_note && p.status !== 'APPROVED' && <p className="text-sm text-fg-muted"><b>Ghi chú của RaceHub:</b> {p.review_note}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setEdit(p)}>Sửa hồ sơ</Button>
                <Link href={routes.partner(p.id)}><Button size="sm" variant="ghost"><ExternalLink className="size-4" aria-hidden />Xem</Button></Link>
              </div>
            </Card>
          ))}
          {!!free.length && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Đăng ký hồ sơ mới</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {free.map((k) => {
                  const Icon = KIND_ICON[k]
                  return (
                    <button key={k} type="button" onClick={() => setEdit(k)} className="rounded-2xl border border-border bg-surface p-3 text-left hover:border-brand">
                      <Icon className="mb-1 size-5 text-brand" aria-hidden />
                      <span className="block font-semibold">{PARTNER_KIND[k].label}</span>
                      <span className="block text-xs text-fg-muted">{PARTNER_KIND[k].hint}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

type Draft = Omit<PartnerInput, 'services' | 'contacts' | 'specialties'> & { services: Partial<PartnerService>[]; contacts: PartnerContacts; specialtiesText: string }

function PartnerForm({ init, onDone }: { init: Partner | PartnerKind; onDone: () => void }) {
  const qc = useQueryClient()
  const [d, setD] = useState<Draft>(() => typeof init === 'string'
    ? { kind: init, name: '', services: [], contacts: {}, specialtiesText: '' }
    : { id: init.id, kind: init.kind, name: init.name, tagline: init.tagline, bio: init.bio, avatar_url: init.avatar_url, cover_url: init.cover_url,
        area: init.area, address: init.address, services: init.services ?? [], contacts: init.contacts ?? {}, specialtiesText: init.specialties.join(', ') })
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))
  const setContact = (k: keyof PartnerContacts, v: string) => set({ contacts: { ...d.contacts, [k]: v } })
  const setService = (i: number, p: Partial<PartnerService>) => set({ services: d.services.map((s, j) => (j === i ? { ...s, ...p } : s)) })
  const [busy, setBusy] = useState<'avatar' | 'cover' | null>(null)
  const upload = async (key: 'avatar_url' | 'cover_url', f: File | undefined) => {
    if (!f) return
    setBusy(key === 'avatar_url' ? 'avatar' : 'cover')
    try { set({ [key]: await uploadPartnerImage(f) }) } catch (e) { toast.error(marketErrorMessage(e)) } finally { setBusy(null) }
  }
  const save = useMutation({
    mutationFn: () => {
      const { specialtiesText, ...rest } = d
      return savePartner({ ...rest, specialties: specialtiesText.split(',').map((s) => s.trim()).filter(Boolean) })
    },
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['market'] })
      toast.success(p.status === 'APPROVED' ? 'Đã cập nhật hồ sơ' : 'Đã gửi hồ sơ — RaceHub sẽ xác minh và báo cho bạn')
      onDone()
    },
    onError: (e) => toast.error(marketErrorMessage(e)),
  })
  const kind = d.kind as PartnerKind
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">{d.id ? 'Sửa hồ sơ' : 'Đăng ký hồ sơ'} · {PARTNER_KIND[kind].label}</h1>
        <p className="text-sm text-fg-muted">Thông tin thật giúp xác minh nhanh. Không ghi số tài khoản ngân hàng — RaceHub không thu tiền hộ.</p>
      </header>
      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <ImagePick label={kind === 'COACH' ? 'Ảnh chân dung' : 'Logo'} url={d.avatar_url ?? null} busy={busy === 'avatar'}
            onPick={(f) => void upload('avatar_url', f)} onClear={() => set({ avatar_url: null })} />
          <ImagePick label="Ảnh bìa" url={d.cover_url ?? null} busy={busy === 'cover'} onPick={(f) => void upload('cover_url', f)} onClear={() => set({ cover_url: null })} />
        </div>
        <Field label={kind === 'COACH' ? 'Tên HLV' : 'Tên cửa hàng / dịch vụ'} htmlFor="pt-name">
          <Input id="pt-name" value={d.name ?? ''} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Giới thiệu ngắn" htmlFor="pt-tag" hint="Một câu hiện trên danh sách.">
          <Input id="pt-tag" value={d.tagline ?? ''} maxLength={120} onChange={(e) => set({ tagline: e.target.value })}
            placeholder={kind === 'COACH' ? 'VD: Luyện marathon sub 4 cho người đi làm' : kind === 'SHOP' ? 'VD: Giày chạy chính hãng, thử giày miễn phí' : 'VD: Massage thể thao sau giải'} />
        </Field>
        <Field label="Chuyên môn / mặt hàng" htmlFor="pt-sp" hint="Cách nhau bằng dấu phẩy, tối đa 12.">
          <Input id="pt-sp" value={d.specialtiesText} onChange={(e) => set({ specialtiesText: e.target.value })} placeholder="Marathon, Trail, Chạy bền cho người mới" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tỉnh / thành" htmlFor="pt-area">
            <select id="pt-area" value={d.area ?? ''} onChange={(e) => set({ area: e.target.value || null })} className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm">
              <option value="">— Chọn —</option>
              {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Địa chỉ (không bắt buộc)" htmlFor="pt-addr">
            <Input id="pt-addr" value={d.address ?? ''} maxLength={160} onChange={(e) => set({ address: e.target.value })} placeholder={kind === 'COACH' ? 'VD: Tập tại hồ Gươm' : 'Số nhà, đường, phường'} />
          </Field>
        </div>
        <Field label="Giới thiệu chi tiết" htmlFor="pt-bio">
          <Textarea id="pt-bio" value={d.bio ?? ''} maxLength={2000} rows={5} onChange={(e) => set({ bio: e.target.value })}
            placeholder={kind === 'COACH' ? 'Kinh nghiệm, chứng chỉ, thành tích, cách kèm tập…' : 'Giới thiệu, giờ mở cửa, chính sách…'} />
        </Field>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Dịch vụ & giá tham khảo</h2>
          <Button size="sm" variant="secondary" disabled={d.services.length >= 12} onClick={() => set({ services: [...d.services, { name: '' }] })}><Plus className="size-4" aria-hidden />Thêm</Button>
        </div>
        {!d.services.length && <p className="text-sm text-fg-muted">VD: “Giáo án 12 tuần — 1.500.000đ / gói”, “Massage 60 phút — 350.000đ / buổi”.</p>}
        {d.services.map((s, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-border p-3">
            <div className="flex gap-2">
              <Input value={s.name ?? ''} maxLength={80} onChange={(e) => setService(i, { name: e.target.value })} placeholder="Tên dịch vụ" aria-label={`Tên dịch vụ ${i + 1}`} />
              <Button size="sm" variant="ghost" aria-label="Xóa dịch vụ" onClick={() => set({ services: d.services.filter((_, j) => j !== i) })}><Trash2 className="size-4" aria-hidden /></Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input value={s.price ?? ''} maxLength={40} onChange={(e) => setService(i, { price: e.target.value })} placeholder="Giá: 350.000đ" aria-label="Giá" />
              <Input value={s.unit ?? ''} maxLength={30} onChange={(e) => setService(i, { unit: e.target.value })} placeholder="Đơn vị: buổi, tháng" aria-label="Đơn vị" />
            </div>
            <Input value={s.description ?? ''} maxLength={300} onChange={(e) => setService(i, { description: e.target.value })} placeholder="Mô tả ngắn (không bắt buộc)" aria-label="Mô tả" />
          </div>
        ))}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Liên hệ</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Điện thoại" htmlFor="pt-phone"><Input id="pt-phone" inputMode="tel" value={d.contacts.phone ?? ''} onChange={(e) => setContact('phone', e.target.value)} placeholder="0912 345 678" /></Field>
          <Field label="Zalo (số hoặc link)" htmlFor="pt-zalo"><Input id="pt-zalo" value={d.contacts.zalo ?? ''} onChange={(e) => setContact('zalo', e.target.value)} placeholder="0912 345 678" /></Field>
          <Field label="Facebook" htmlFor="pt-fb"><Input id="pt-fb" inputMode="url" value={d.contacts.facebook ?? ''} onChange={(e) => setContact('facebook', e.target.value)} placeholder="https://facebook.com/…" /></Field>
          <Field label="Website" htmlFor="pt-web"><Input id="pt-web" inputMode="url" value={d.contacts.website ?? ''} onChange={(e) => setContact('website', e.target.value)} placeholder="https://…" /></Field>
          <Field label="Email" htmlFor="pt-mail"><Input id="pt-mail" inputMode="email" value={d.contacts.email ?? ''} onChange={(e) => setContact('email', e.target.value)} /></Field>
        </div>
      </Card>

      <div className="flex gap-2">
        <Button variant="ghost" onClick={onDone}>Hủy</Button>
        <Button block onClick={() => save.mutate()} loading={save.isPending} disabled={!!busy || (d.name ?? '').trim().length < 2}>
          {d.id ? 'Lưu hồ sơ' : 'Gửi xác minh'}
        </Button>
      </div>
    </div>
  )
}
