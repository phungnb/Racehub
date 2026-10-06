'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Loader2, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { myReferral, referralLink } from '../api/referralApi'
import { inviteMessage, inviteRewardText } from '../model/invite'
import { shareInvite } from './shareInvite'

/**
 * Trang chủ (chỉnh sửa lần 7): thay dòng "Chạy từ 1 km hôm nay để tự điểm danh…" bằng nút "Gửi link mời bạn bè".
 * Bấm là mở bảng Chia sẻ với lời mời + link /join/<mã>; số Xu lấy từ luật hiện hành máy chủ trả về (my_referral.rules), không ghi cứng.
 */
export function InviteFriendsCard({ className }: { className?: string }) {
  const q = useQuery({ queryKey: ['referral', 'mine'], queryFn: myReferral, staleTime: 5 * 60_000, retry: 1 })
  const [busy, setBusy] = useState(false)
  const r = q.data?.code ? q.data : null

  const send = async () => {
    if (!r) return
    setBusy(true)
    try {
      const res = await shareInvite(inviteMessage(r.code, referralLink(r.code), r.rules.referee_xu))
      if (res === 'copied') toast.success('Đã sao chép lời mời — dán vào Zalo / Messenger để gửi bạn bè')
      else if (res === 'failed') toast.error('Không mở được chia sẻ. Vào trang Mời bạn bè để sao chép link.')
    } finally { setBusy(false) }
  }

  const body = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand">
        {busy || q.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Share2 className="size-4" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Gửi link mời bạn bè</span>
        <span className="block text-xs text-fg-muted">{inviteRewardText(r?.rules)}</span>
      </span>
    </>
  )
  const box = 'flex min-h-11 flex-1 items-center gap-3 rounded-xl border border-dashed border-brand/50 bg-brand/5 px-3 py-2 text-left hover:border-brand'
  return (
    <div className={cn('flex items-stretch gap-2', className)}>
      {/* Chưa lấy được mã (máy chủ chưa có hàm / lỗi mạng): đưa sang trang Mời bạn bè để thử lại */}
      {r || q.isPending ? (
        <button type="button" onClick={() => void send()} disabled={!r || busy} className={box}>{body}</button>
      ) : (
        <Link href={routes.invite} className={box}>{body}</Link>
      )}
      <Link href={routes.invite} aria-label="Mã giới thiệu, QR và bạn đã mời"
        className="grid w-11 shrink-0 place-items-center rounded-xl border border-border text-fg-subtle hover:border-fg-subtle">
        <ChevronRight className="size-4" aria-hidden />
      </Link>
    </div>
  )
}
