'use client'

import { use, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Footprints, Gift, Loader2, Trophy, Users } from 'lucide-react'
import { applyReferral, referralErrorMessage, referralPreview } from '@/features/referral'
import { savePendingReferral, useSession } from '@/features/auth'
import { Avatar, Button, Card, EmptyState } from '@/shared/ui'
import { routes } from '@/shared/config/routes'

/** Trang lời mời giới thiệu /join/<mã>: ai mời, được gì; chưa có tài khoản → đăng ký (mã được điền sẵn); đã đăng nhập → nhận lời mời */
export default function ReferralPage({ params }: PageProps<'/join/[code]'>) {
  const { code } = use(params)
  const router = useRouter()
  const auto = useSearchParams().get('auto') === '1'
  const { session, loading } = useSession()
  const preview = useQuery({ queryKey: ['referral', 'preview', code], queryFn: () => referralPreview(code) })
  const tried = useRef(false)
  const accept = useMutation({
    mutationFn: () => applyReferral(code),
    onSuccess: (r) => {
      toast.success(`Đã nhận lời mời của ${r.referrer_name}! Chạy đủ km đầu tiên để cả hai nhận Xu 🎉`)
      router.replace(routes.home)
    },
  })
  const error = accept.error ? referralErrorMessage(accept.error) : null
  // Vừa đăng ký / đăng nhập từ link mời → tự nhận
  useEffect(() => {
    if (auto && session && !tried.current) { tried.current = true; accept.mutate() }
  })

  const signUp = () => { savePendingReferral(code); router.push(routes.login) }
  const p = preview.data

  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center p-4">
      {loading || preview.isPending ? (
        <Loader2 className="size-7 animate-spin text-brand" aria-label="Đang mở lời mời" />
      ) : !p ? (
        <EmptyState icon={Gift} title="Link mời không đúng" description="Mã giới thiệu không tồn tại. Hãy xin lại link từ bạn bè."
          action={<Button variant="secondary" onClick={() => router.replace(session ? routes.home : routes.login)}>{session ? 'Về trang chủ' : 'Đăng nhập'}</Button>} />
      ) : (
        <Card className="w-full space-y-5 p-6 text-center">
          <div className="flex flex-col items-center gap-2">
            <Avatar src={p.avatar_url} name={p.display_name} size="xl" />
            <p className="text-sm text-fg-muted"><span className="font-semibold text-fg">{p.display_name}</span> mời bạn chạy cùng trên</p>
            <h1 className="text-2xl font-black tracking-wide text-brand">RACEHUB</h1>
          </div>
          <ul className="space-y-2 text-left text-sm">
            <li className="flex gap-3"><Footprints className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />Ghi bài chạy bằng app hoặc tự đồng bộ từ Strava, Garmin, COROS…</li>
            <li className="flex gap-3"><Users className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />Vào CLB, chat, thử thách đội cùng bạn bè</li>
            <li className="flex gap-3"><Trophy className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />Lên cấp, nhận Xu, huy hiệu, giải chạy ảo có BIB & chứng nhận</li>
            {p.referee_xu > 0 && <li className="flex gap-3"><Gift className="mt-0.5 size-4 shrink-0 text-coin" aria-hidden />
              <span>Quà chào mừng <b className="text-coin">{p.referee_xu} Xu</b> khi bạn chạy đủ {p.min_km} km đầu tiên</span></li>}
          </ul>
          <p className="text-xs text-fg-subtle">Mã giới thiệu <span className="font-mono font-bold tracking-widest text-fg">{p.code}</span></p>
          {error && <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
          {session ? (
            error ? <Button block variant="secondary" onClick={() => router.replace(routes.home)}>Về trang chủ</Button>
              : <Button block size="lg" loading={accept.isPending} onClick={() => accept.mutate()}>Nhận lời mời</Button>
          ) : (
            <div className="space-y-2">
              <Button block size="lg" onClick={signUp}>Tạo tài khoản miễn phí</Button>
              <Button block variant="ghost" onClick={signUp}>Tôi đã có tài khoản — đăng nhập</Button>
            </div>
          )}
        </Card>
      )}
    </main>
  )
}
