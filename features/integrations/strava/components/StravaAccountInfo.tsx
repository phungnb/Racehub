'use client'

import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { cn } from '@/shared/lib/cn'
import { myStravaAccount, refreshStravaAccount, stravaProfileUrl, type StravaAccount } from '../api/accountApi'
import { STRAVA_ORANGE } from './StravaBrand'

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('vi-VN') : null)

/** Thẻ nhận diện tài khoản Strava: ảnh, tên, @username, athlete id, link hồ sơ. Dùng cho người dùng (Tôi) và admin (Người dùng) */
export function StravaAccountInfo({ account, className }: { account: Pick<StravaAccount, 'athlete_id' | 'name' | 'username' | 'avatar_url'> & Partial<StravaAccount>; className?: string }) {
  const title = account.name || (account.username ? `@${account.username}` : `Athlete ${account.athlete_id}`)
  return (
    <div className={cn('flex items-center gap-3 rounded-xl bg-surface-2 p-3', className)}>
      {account.avatar_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={account.avatar_url} alt="" referrerPolicy="no-referrer" className="size-11 shrink-0 rounded-full object-cover" />
        : <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#fc4c02]/15 font-black text-[#fc4c02]" aria-hidden>S</span>}
      <div className="min-w-0 flex-1 text-sm">
        <p className="truncate font-semibold">{title}</p>
        <p className="truncate text-xs text-fg-muted">
          {account.name && account.username ? `@${account.username} · ` : ''}ID {account.athlete_id}
          {fmtDate(account.connected_at ?? null) ? ` · nối ${fmtDate(account.connected_at ?? null)}` : ''}
        </p>
        <a href={stravaProfileUrl(account.athlete_id)} target="_blank" rel="noopener noreferrer"
          className="text-xs font-bold underline" style={{ color: STRAVA_ORANGE }}>View on Strava</a>
      </div>
    </div>
  )
}

/** Tài khoản Strava của chính người dùng; kết nối cũ chưa có tên / ảnh thì tự bổ sung một lần */
export function MyStravaAccount() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['strava-account'], queryFn: myStravaAccount, staleTime: 60_000 })
  const tried = useRef(false)
  const needsFill = Boolean(q.data && !q.data.name && !q.data.avatar_url)
  useEffect(() => {
    if (!needsFill || tried.current) return
    tried.current = true
    void refreshStravaAccount().then((ok) => { if (ok) void qc.invalidateQueries({ queryKey: ['strava-account'] }) }).catch(() => undefined)
  }, [needsFill, qc])
  if (!q.data) return null
  return <StravaAccountInfo account={q.data} />
}
