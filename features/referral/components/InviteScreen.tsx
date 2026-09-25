'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, Copy, Download, Gift, Share2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ErrorState, Input, Skeleton, useImageSaver } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import { applyReferral, myReferral, referralErrorMessage, referralLink, type MyReferral } from '../api/referralApi'

/** Tôi → Mời bạn bè: mã ngắn, link, QR, bạn đã mời, Xu đã nhận; nhập mã của người mời mình (14 ngày đầu) */
export function InviteScreen() {
  const q = useQuery({ queryKey: ['referral', 'mine'], queryFn: myReferral })
  return (
    <div className="space-y-4 animate-fade-in">
      <Link href={routes.me} className="inline-flex items-center gap-1 text-sm text-fg-muted"><ChevronLeft className="size-4" aria-hidden />Tôi</Link>
      <header>
        <h1 className="text-2xl font-bold">Mời bạn bè</h1>
        <p className="text-sm text-fg-muted">Rủ bạn chạy cùng — cả hai cùng nhận Xu khi bạn mới hoàn thành những km đầu tiên.</p>
      </header>
      {q.isPending ? <Skeleton className="h-72" /> : q.isError || !q.data?.code ? <ErrorState message={q.error ? referralErrorMessage(q.error) : 'Chưa lấy được mã giới thiệu. Thử lại sau.'} error={q.error} onRetry={() => void q.refetch()} />
        : <InviteBody r={q.data} />}
    </div>
  )
}

function InviteBody({ r }: { r: MyReferral }) {
  const link = referralLink(r.code)
  const [qr, setQr] = useState<string | null>(null)
  const saver = useImageSaver()
  useEffect(() => {
    let alive = true
    if (link) void QRCode.toDataURL(link, { width: 640, margin: 1, errorCorrectionLevel: 'M' }).then((d) => { if (alive) setQr(d) })
    return () => { alive = false }
  }, [link])
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`Đã sao chép ${what}`) } catch { toast.error('Không sao chép được, hãy chọn và sao chép thủ công.') }
  }
  const message = `Chạy cùng mình trên RaceHub nhé! Mã giới thiệu ${r.code}${r.rules.referee_xu > 0 ? ` — nhận ${r.rules.referee_xu} Xu chào mừng` : ''}: ${link}`
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'Chạy cùng mình trên RaceHub', text: message, url: link }) } catch { /* hủy */ } }
    else void copy(message, 'lời mời')
  }
  const saveQr = async () => { if (qr) void saver.saveBlob(await (await fetch(qr)).blob(), `racehub-moi-${r.code}.png`, 'Mã mời RaceHub') }
  return (
    <>
      <Card className="space-y-4 text-center">
        <div className="mx-auto w-fit rounded-2xl bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- QR sinh tại chỗ */}
          {qr ? <img src={qr} alt="Mã QR mời bạn vào RaceHub" className="size-44" /> : <Skeleton className="size-44" />}
        </div>
        <div>
          <p className="text-xs text-fg-subtle">Mã giới thiệu của bạn</p>
          <button type="button" onClick={() => copy(r.code, 'mã giới thiệu')} className="mt-1 inline-flex items-center gap-2 rounded-xl border-2 border-dashed border-brand/50 bg-brand/10 px-4 py-2">
            <span className="font-mono text-2xl font-black tracking-[0.25em] text-brand">{r.code}</span><Copy className="size-4 text-brand" aria-label="Sao chép mã" />
          </button>
        </div>
        <p className="break-all rounded-xl bg-bg p-2 font-mono text-xs text-fg-muted">{link}</p>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="secondary" className="gap-1.5 px-2 text-sm" onClick={() => copy(link, 'link mời')}><Copy className="size-4" aria-hidden />Link</Button>
          <Button variant="secondary" className="gap-1.5 px-2 text-sm" disabled={!qr} loading={saver.busy} onClick={() => void saveQr()}><Download className="size-4" aria-hidden />Lưu QR</Button>
          <Button className="gap-1.5 px-2 text-sm" onClick={() => void share()}><Share2 className="size-4" aria-hidden />Chia sẻ</Button>
        </div>
        {saver.sheet}
      </Card>

      <Card className="space-y-2">
        <h2 className="font-semibold">Thể lệ</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
          <li>Bạn mới đăng ký bằng link / mã của bạn (hoặc nhập mã trong 14 ngày đầu).</li>
          <li>Khi bạn mới chạy đủ <b>{r.rules.min_km} km</b> hợp lệ: bạn nhận <b className="text-coin">{r.rules.inviter_xu} Xu</b>, bạn mới nhận <b className="text-coin">{r.rules.referee_xu} Xu</b>.</li>
          <li>Tối đa {r.rules.monthly_cap} lượt thưởng giới thiệu mỗi tháng. Tài khoản ảo / gian lận không được tính.</li>
        </ul>
      </Card>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Đã mời" value={r.invited} />
        <Stat label="Đã chạy đủ" value={r.rewarded} />
        <Stat label="Xu nhận được" value={r.xu_earned} coin />
      </div>

      {r.friends.length > 0 && (
        <Card className="space-y-2">
          <h2 className="flex items-center gap-2 font-semibold"><Users className="size-4" aria-hidden />Bạn bè đã tham gia</h2>
          <ul className="divide-y divide-border">
            {r.friends.map((f, i) => (
              <li key={i} className="flex items-center gap-3 py-2">
                <Avatar src={f.avatar_url} name={f.display_name} size="sm" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{f.display_name}</span>
                  <span className="text-xs text-fg-subtle">Tham gia {new Date(f.joined_at).toLocaleDateString('vi-VN')}</span></span>
                <span className={f.rewarded ? 'text-xs font-semibold text-coin' : 'text-xs text-fg-subtle'}>{f.rewarded ? `+${r.rules.inviter_xu} Xu` : `Chưa đủ ${r.rules.min_km} km`}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <EnterCode r={r} />
    </>
  )
}

function Stat({ label, value, coin }: { label: string; value: number; coin?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-2 py-3">
      <p className={coin ? 'font-mono text-xl font-bold text-coin' : 'font-mono text-xl font-bold'}>{Number(value).toLocaleString('vi-VN')}</p>
      <p className="text-xs text-fg-subtle">{label}</p>
    </div>
  )
}

function EnterCode({ r }: { r: MyReferral }) {
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const apply = useMutation({
    mutationFn: () => applyReferral(code),
    onSuccess: (x) => { toast.success(`Đã ghi nhận lời mời của ${x.referrer_name}`); void qc.invalidateQueries({ queryKey: ['referral'] }) },
    onError: (e) => toast.error(referralErrorMessage(e)),
  })
  if (r.referred_by) {
    return (
      <Card className="flex items-center gap-3 text-sm">
        <Check className="size-5 shrink-0 text-brand" aria-hidden />
        <span>Bạn tham gia RaceHub nhờ lời mời của <b>{r.referred_by.display_name}</b>.</span>
      </Card>
    )
  }
  if (!r.can_enter_code) return null
  return (
    <Card className="space-y-2">
      <h2 className="flex items-center gap-2 font-semibold"><Gift className="size-4 text-coin" aria-hidden />Bạn được ai mời?</h2>
      <p className="text-xs text-fg-muted">Nhập mã giới thiệu của người đã rủ bạn{r.enter_until ? ` (trước ${new Date(r.enter_until).toLocaleDateString('vi-VN')})` : ''} để cả hai nhận Xu.</p>
      <div className="flex gap-2">
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={40} placeholder="VD: K7M2Q9XA" aria-label="Mã giới thiệu"
          className="font-mono uppercase tracking-widest" />
        <Button onClick={() => apply.mutate()} loading={apply.isPending} disabled={code.trim().length < 6}>Áp dụng</Button>
      </div>
    </Card>
  )
}
