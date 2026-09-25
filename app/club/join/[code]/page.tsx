'use client'

import { use, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Crown, Loader2, Lock, ShieldX, Users } from 'lucide-react'
import { joinClubByCode, clubErrorMessage, clubInvitePreview, myClubByInvite } from '@/features/club'
import { savePendingClubCode, useSession } from '@/features/auth'
import { Button, Card, EmptyState } from '@/shared/ui'
import { routes } from '@/shared/config/routes'

const POLICY = {
  OPEN: 'Ai cũng tham gia được',
  APPROVAL: 'Ban quản trị duyệt yêu cầu tham gia',
  INVITE_ONLY: 'Chỉ qua link mời — bạn đang có link hợp lệ',
} as const

/** Link mời CLB /club/join/<mã>: xem trước CLB rồi mới tham gia; chưa đăng nhập → đăng nhập xong tự quay lại và tham gia */
export default function JoinClubPage({ params }: PageProps<'/club/join/[code]'>) {
  const { code } = use(params)
  const router = useRouter()
  const auto = useSearchParams().get('auto') === '1'
  const { session, loading } = useSession()
  const preview = useQuery({ queryKey: ['club-invite', code, !!session], queryFn: () => clubInvitePreview(code), enabled: !loading })
  const tried = useRef(false)
  const c = preview.data

  const join = useMutation({
    mutationFn: () => joinClubByCode(code),
    onSuccess: (member) => {
      toast.success(member.status === 'APPROVED' ? 'Chào mừng bạn đến với CLB!' : 'Đã gửi yêu cầu, chờ ban quản trị duyệt.')
      router.replace(member.status === 'APPROVED' ? routes.clubTab(member.club_id, 'chat') : routes.club(member.club_id))
    },
    onError: async (e) => {
      if (e instanceof Error && e.message.includes('ALREADY_MEMBER')) {
        const id = await myClubByInvite(code).catch(() => null)
        if (id) router.replace(routes.club(id))
      }
    },
  })
  const error = join.error && !(join.error instanceof Error && join.error.message.includes('ALREADY_MEMBER')) ? clubErrorMessage(join.error) : null
  useEffect(() => {
    if (!session || !c || tried.current) return
    // Đã là thành viên → vào thẳng CLB; vừa đăng nhập từ link mời → tự tham gia
    if (c.my_status === 'APPROVED') { tried.current = true; router.replace(routes.club(c.id)); return }
    if (auto && c.my_status !== 'PENDING' && c.my_status !== 'BANNED') { tried.current = true; join.mutate() }
  })

  const login = () => { savePendingClubCode(code); router.push(routes.login) }

  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center p-4">
      {loading || preview.isPending ? (
        <Loader2 className="size-7 animate-spin text-brand" aria-label="Đang mở lời mời" />
      ) : !c ? (
        <EmptyState icon={ShieldX} title="Link mời không còn hiệu lực" description="Mã mời sai hoặc đã được ban quản trị đổi. Hãy xin link mời mới."
          action={<Button variant="secondary" onClick={() => router.replace(session ? routes.clubs : routes.login)}>{session ? 'Về danh sách CLB' : 'Đăng nhập'}</Button>} />
      ) : (
        <Card className="w-full space-y-4 p-6 text-center">
          <span className="mx-auto grid size-20 place-items-center overflow-hidden rounded-2xl text-3xl font-black text-white"
            style={{ background: c.accent_color ?? 'var(--color-brand)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- logo CLB trong kho ảnh */}
            {c.avatar_url ? <img src={c.avatar_url} alt="" className="h-full w-full object-cover" /> : c.name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <p className="text-sm text-fg-muted">Bạn được mời vào CLB</p>
            <h1 className="flex items-center justify-center gap-2 text-2xl font-bold">{c.name}{c.plan === 'PRO' && <Crown className="size-5 text-coin" aria-label="CLB Pro" />}</h1>
          </div>
          {c.description && <p className="whitespace-pre-line text-sm text-fg-muted">{c.description}</p>}
          <div className="flex justify-center gap-4 text-sm text-fg-muted">
            <span className="flex items-center gap-1"><Users className="size-4" aria-hidden />{c.member_count.toLocaleString('vi-VN')} thành viên</span>
            <span className="flex items-center gap-1"><Lock className="size-4" aria-hidden />{POLICY[c.join_policy]}</span>
          </div>
          {error && <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
          {c.full ? <p className="rounded-xl bg-warning/10 p-3 text-sm text-warning">CLB đã đủ thành viên.</p>
            : c.my_status === 'BANNED' ? <p className="rounded-xl bg-danger/10 p-3 text-sm text-danger">Bạn không thể tham gia CLB này.</p>
            : c.my_status === 'PENDING' ? <p className="rounded-xl bg-surface-2 p-3 text-sm">Bạn đã gửi yêu cầu — chờ ban quản trị duyệt.</p>
            : session ? (
              <Button block size="lg" loading={join.isPending} onClick={() => join.mutate()}>
                {c.join_policy === 'APPROVAL' ? 'Gửi yêu cầu tham gia' : 'Tham gia CLB'}
              </Button>
            ) : (
              <div className="space-y-2">
                <Button block size="lg" onClick={login}>Đăng nhập để tham gia</Button>
                <p className="text-xs text-fg-subtle">Chưa có tài khoản? Tạo miễn phí — xong sẽ tự quay lại CLB này.</p>
              </div>
            )}
        </Card>
      )}
    </main>
  )
}
