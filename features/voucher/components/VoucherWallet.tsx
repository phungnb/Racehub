'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, Copy, ExternalLink, Ticket } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { markVoucherUsed, myVouchers, voucherErrorMessage, type MyVoucher } from '../api/voucherApi'

export function SponsorLogo({ name, url, className }: { name: string; url: string | null; className?: string }) {
  return (
    <span className={cn('grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-white text-sm font-black text-slate-800', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- logo nhà tài trợ (link ngoài) */}
      {url ? <img src={url} alt={name} className="h-full w-full object-contain p-1" /> : name.slice(0, 2).toUpperCase()}
    </span>
  )
}

/** Ví voucher: mã nhận được từ nhà tài trợ khi hoàn thành thử thách / nhiệm vụ */
export function VoucherWallet() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['vouchers', 'mine'], queryFn: myVouchers })
  const mark = useMutation({
    mutationFn: ({ id, used }: { id: string; used: boolean }) => markVoucherUsed(id, used),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['vouchers', 'mine'] }),
    onError: (e) => toast.error(voucherErrorMessage(e)),
  })
  return (
    <div className="space-y-4 animate-fade-in">
      <Link href={routes.me} className="inline-flex items-center gap-1 text-sm text-fg-muted"><ChevronLeft className="size-4" aria-hidden />Tôi</Link>
      <header>
        <h1 className="text-2xl font-bold">Voucher của tôi</h1>
        <p className="text-sm text-fg-muted">Quà từ nhà tài trợ khi bạn hoàn thành thử thách / nhiệm vụ. Dùng trực tiếp tại cửa hàng / dịch vụ của nhà tài trợ.</p>
      </header>
      {q.isPending ? <Skeleton className="h-40" /> : q.isError ? <ErrorState message={voucherErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : !q.data.length ? <EmptyState icon={Ticket} title="Chưa có voucher" description="Tham gia thử thách có nhà tài trợ để nhận voucher khi hoàn thành." />
        : <ul className="space-y-3">{q.data.map((v) => <li key={v.campaign_id}><VoucherCard v={v} onUsed={(used) => mark.mutate({ id: v.campaign_id, used })} /></li>)}</ul>}
    </div>
  )
}

function VoucherCard({ v, onUsed }: { v: MyVoucher; onUsed: (used: boolean) => void }) {
  const [now] = useState(() => Date.now())
  const expired = !!v.valid_until && Date.parse(v.valid_until) < now
  const copy = () => { void navigator.clipboard?.writeText(v.code); toast.success('Đã sao chép mã') }
  return (
    <Card className={cn('space-y-3', (v.used_at || expired) && 'opacity-60')}>
      <div className="flex items-center gap-3">
        <SponsorLogo name={v.sponsor_name} url={v.sponsor_logo} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{v.sponsor_name}</p>
          <p className="font-semibold leading-snug">{v.title}</p>
        </div>
      </div>
      <button type="button" onClick={copy} className="flex w-full items-center justify-between rounded-xl border-2 border-dashed border-coin/60 bg-coin/10 px-4 py-3">
        <span className="font-mono text-lg font-black tracking-widest text-coin">{v.code}</span>
        <Copy className="size-4 text-coin" aria-label="Sao chép" />
      </button>
      {v.terms && <p className="whitespace-pre-line text-xs text-fg-muted">{v.terms}</p>}
      <p className="text-xs text-fg-subtle">
        Từ {v.target_type === 'CHALLENGE' ? 'thử thách' : 'nhiệm vụ'} “{v.target_name ?? ''}”
        {v.valid_until && ` · ${expired ? 'đã hết hạn' : 'hạn dùng'} ${new Date(v.valid_until).toLocaleDateString('vi-VN')}`}
      </p>
      <div className="flex gap-2">
        {v.redeem_url && (
          <a href={v.redeem_url} target="_blank" rel="noopener noreferrer" className="flex-1">
            <Button block size="sm" variant="secondary"><ExternalLink className="size-4" aria-hidden />Dùng ngay</Button>
          </a>
        )}
        <Button size="sm" variant="ghost" onClick={() => onUsed(!v.used_at)}>
          <Check className="size-4" aria-hidden />{v.used_at ? 'Đã dùng · bỏ đánh dấu' : 'Đánh dấu đã dùng'}
        </Button>
      </div>
    </Card>
  )
}
