'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { routes } from '@/shared/config/routes'
import { fmtDuration, fmtKm, fmtPace, listAthleteActivities, paceOf } from '../api/athleteApi'

interface Props {
  userId: string
}

/** 10 bài chạy gần nhất của một VĐV — qua RPC list_athlete_activities (tôn trọng cài đặt riêng tư, chỉ bài hợp lệ) */
export default function ActivityHistory({ userId }: Props) {
  const q = useQuery({ queryKey: ['athlete', userId, 'activities'], queryFn: () => listAthleteActivities(userId, 10) })

  if (q.isPending) {
    return <div className="bg-surface border border-border rounded-2xl p-4 text-center text-fg-subtle text-xs">Đang tải hoạt động...</div>
  }
  if (q.isError) {
    return <div className="bg-surface border border-border rounded-2xl p-4 text-center text-fg-subtle text-xs">Không tải được hoạt động lúc này.</div>
  }
  if (q.data.length === 0) {
    return <div className="bg-surface border border-border rounded-2xl p-4 text-center text-fg-subtle text-xs">Chưa có hoạt động nào gần đây.</div>
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 space-y-3 shadow-xl text-xs">
      <h4 className="font-bold text-fg-muted uppercase tracking-wider">🏃 Hoạt động gần đây</h4>
      <div className="space-y-2">
        {q.data.map((act) => {
          const pace = act.avg_pace_s ?? paceOf(act.distance_m, act.moving_time_s)
          return (
            <Link key={act.id} href={routes.activity(act.id)} className="bg-bg p-3 rounded-xl border border-border/80 flex items-center justify-between hover:border-fg-subtle">
              <div>
                <p className="font-bold text-white">{act.title || 'Chạy bộ'}</p>
                <p className="text-xs text-fg-subtle">{act.started_at ? new Date(act.started_at).toLocaleDateString('vi-VN') : ''}</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-brand">{fmtKm(act.distance_m)} km</p>
                <p className="text-xs text-fg-muted">{fmtDuration(act.moving_time_s)} • {fmtPace(pace)}/km</p>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
