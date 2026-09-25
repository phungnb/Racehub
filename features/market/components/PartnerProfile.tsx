'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, Globe, Mail, MapPin, MessageCircle, Pencil, Phone, ThumbsUp } from 'lucide-react'
import { Avatar, Button, Card, ErrorState, LevelBadge, Skeleton } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import { contactLinks, getPartner, marketErrorMessage, PARTNER_KIND, type PartnerContacts } from '../api/marketApi'
import { PartnerLogo, VerifiedBadge } from './PartnerBits'

const CONTACT_ICON: Record<keyof PartnerContacts, typeof Phone> = { phone: Phone, zalo: MessageCircle, facebook: ThumbsUp, website: Globe, email: Mail }
const STATUS_LABEL = { PENDING: 'Đang chờ xác minh', REJECTED: 'Cần bổ sung', HIDDEN: 'Đang bị ẩn', APPROVED: '' } as const

/** Trang hồ sơ đối tác: giới thiệu, dịch vụ + giá tham khảo, liên hệ trực tiếp; HLV có thành tích chạy thật */
export function PartnerProfile({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['market', 'partner', id], queryFn: () => getPartner(id) })
  const back = <Link href={routes.market} className="inline-flex items-center gap-1 text-sm text-fg-muted"><ChevronLeft className="size-4" aria-hidden />Chợ Runner</Link>
  if (q.isPending) return <div className="space-y-4">{back}<Skeleton className="h-48" /><Skeleton className="h-32" /></div>
  if (q.isError) return <div className="space-y-4">{back}<ErrorState message={marketErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} /></div>
  const p = q.data
  const links = contactLinks(p.contacts)
  return (
    <div className="space-y-4 animate-fade-in">
      {back}
      <Card className="overflow-hidden p-0">
        <div className="h-32 bg-gradient-to-br from-brand/40 to-surface-2 sm:h-44">
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh bìa trong kho market-media */}
          {p.cover_url && <img src={p.cover_url} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="space-y-2 p-4 pt-0">
          <PartnerLogo p={p} className="-mt-8 size-16 border-4 border-surface" />
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">{p.name}</h1>
            {p.verified && <VerifiedBadge />}
            {p.status !== 'APPROVED' && <span className="rounded-full bg-coin/15 px-2 py-0.5 text-[11px] font-bold text-coin">{STATUS_LABEL[p.status]}</span>}
          </div>
          {p.tagline && <p className="text-fg-muted">{p.tagline}</p>}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-subtle">
            <span>{PARTNER_KIND[p.kind].label}</span>
            {(p.address || p.area) && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{[p.address, p.area].filter(Boolean).join(', ')}</span>}
          </p>
          {!!p.specialties.length && (
            <div className="flex flex-wrap gap-1.5">{p.specialties.map((s) => <span key={s} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs">{s}</span>)}</div>
          )}
          {p.is_mine && <Link href={routes.marketMine}><Button size="sm" variant="secondary"><Pencil className="size-4" aria-hidden />Sửa hồ sơ</Button></Link>}
        </div>
      </Card>

      {p.status === 'REJECTED' && p.review_note && <Card className="border-coin/40 text-sm"><b>Cần bổ sung:</b> {p.review_note}</Card>}

      {!!links.length && (
        <Card className="space-y-2">
          <h2 className="font-semibold">Liên hệ trực tiếp</h2>
          <div className="grid grid-cols-2 gap-2">
            {links.map((l) => {
              const Icon = CONTACT_ICON[l.key]
              return (
                <a key={l.key} href={l.href} target={l.href.startsWith('https://') ? '_blank' : undefined} rel="noopener noreferrer nofollow">
                  <Button block size="sm" variant={l.key === 'phone' || l.key === 'zalo' ? 'primary' : 'secondary'}><Icon className="size-4" aria-hidden />{l.label}</Button>
                </a>
              )
            })}
          </div>
          <p className="text-xs text-fg-subtle">RaceHub không thu tiền hộ — hãy thỏa thuận dịch vụ, giá và thanh toán trực tiếp với đối tác.</p>
        </Card>
      )}

      {p.kind === 'COACH' && p.stats && (
        <Card className="space-y-3">
          <h2 className="font-semibold">Thành tích chạy trên RaceHub</h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-surface-2 p-2"><LevelBadge level={p.stats.level} /><p className="mt-1 text-[11px] text-fg-muted">Cấp độ</p></div>
            <div className="rounded-xl bg-surface-2 p-2"><p className="text-lg font-bold">{Math.round(p.stats.km_12m).toLocaleString('vi-VN')}</p><p className="text-[11px] text-fg-muted">km / 12 tháng</p></div>
            <div className="rounded-xl bg-surface-2 p-2"><p className="text-lg font-bold">{p.stats.runs_12m}</p><p className="text-[11px] text-fg-muted">bài chạy</p></div>
          </div>
          <p className="text-xs text-fg-subtle">Số liệu từ bài chạy đã xác thực, không tự khai.</p>
        </Card>
      )}

      {p.bio && <Card className="space-y-2"><h2 className="font-semibold">Giới thiệu</h2><p className="whitespace-pre-line text-sm leading-relaxed text-fg-muted">{p.bio}</p></Card>}

      {!!p.services?.length && (
        <Card className="space-y-2">
          <h2 className="font-semibold">Dịch vụ & giá tham khảo</h2>
          <ul className="divide-y divide-border">
            {p.services.map((s, i) => (
              <li key={i} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-medium">{s.name}</p>
                  {s.description && <p className="whitespace-pre-line text-xs text-fg-muted">{s.description}</p>}
                </div>
                {s.price && <p className="shrink-0 text-right text-sm font-semibold text-coin">{s.price}{s.unit && <span className="block text-[11px] font-normal text-fg-subtle">/ {s.unit}</span>}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="flex items-center gap-3 p-3">
        <Avatar src={p.owner.avatar_url} name={p.owner.display_name} size="sm" />
        <p className="text-sm text-fg-muted">Chủ hồ sơ: <span className="font-semibold text-fg">{p.owner.display_name}</span></p>
      </Card>
    </div>
  )
}
