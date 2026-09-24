'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Download, Link2, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Sheet, Skeleton } from '@/shared/ui'

const BTN = 'gap-1.5 whitespace-nowrap px-2 text-sm'

export function clubInviteLink(code: string, slug?: string | null) {
  if (typeof window === 'undefined') return ''
  return slug ? `${window.location.origin}/c/${slug}` : `${window.location.origin}/club/join/${code}`
}

/** Link mời + mã QR vào CLB: quét bằng camera điện thoại là mở trang xin vào CLB. */
/** `slug`: link mời riêng của CLB Pro (/c/<slug>) — ngắn, dễ nhớ, in lên áo / banner */
export function InvitePanel({ code, name, slug }: { code: string; name: string; slug?: string | null }) {
  const link = clubInviteLink(code, slug)
  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (link) void QRCode.toDataURL(link, { width: 640, margin: 1, errorCorrectionLevel: 'M' }).then((d) => { if (alive) setQr(d) })
    return () => { alive = false }
  }, [link])

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`Đã sao chép ${what}`) } catch { toast.error('Không sao chép được, hãy chọn và sao chép thủ công.') }
  }
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: `Vào CLB ${name} trên RaceHub`, text: `Tham gia CLB ${name} cùng mình trên RaceHub nhé!`, url: link }) } catch { /* người dùng hủy */ }
    } else void copy(link, 'link mời')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-2">
        <div className="rounded-2xl bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh QR sinh tại chỗ (data URL) */}
          {qr ? <img src={qr} alt={`Mã QR vào CLB ${name}`} className="size-48" /> : <Skeleton className="size-48" />}
        </div>
        <p className="text-center text-xs text-fg-muted">Quét bằng camera điện thoại để vào CLB · Mã mời <span className="font-mono font-bold tracking-widest text-fg">{code}</span></p>
      </div>
      <div className="rounded-xl border border-border bg-bg p-3">
        <p className="flex items-center gap-2 text-xs text-fg-subtle"><Link2 className="size-3.5" aria-hidden />Link mời</p>
        <p className="mt-1 break-all font-mono text-sm">{link}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Button variant="secondary" className={BTN} onClick={() => copy(link, 'link mời')}><Copy className="size-4" aria-hidden />Sao chép</Button>
        <Button variant="secondary" className={BTN} disabled={!qr} onClick={() => {
          if (!qr) return
          const a = document.createElement('a')
          a.href = qr
          a.download = `QR-${name.replace(/[^\p{L}\p{N}]+/gu, '-')}.png`
          a.click()
        }}><Download className="size-4" aria-hidden />Lưu QR</Button>
        <Button className={BTN} onClick={share}><Share2 className="size-4" aria-hidden />Chia sẻ</Button>
      </div>
    </div>
  )
}

export function InviteSheet({ open, onClose, code, name, slug }: { open: boolean; onClose: () => void; code: string; name: string; slug?: string | null }) {
  return (
    <Sheet open={open} onClose={onClose} title="Mời bạn vào CLB" description="Gửi link vào nhóm Zalo/Messenger, hoặc cho bạn quét mã QR.">
      <InvitePanel code={code} name={name} slug={slug} />
    </Sheet>
  )
}
