import { useEffect, useState } from 'react'
import { supabase } from '@/shared/lib/supabase'
import { fmtDuration, fmtKm, fmtPace, paceOf } from '../api/athleteApi'

interface Props {
  userId: string
}

export default function ActivityHistory({ userId }: Props) {
  const [activities, setActivities] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const fetchActivities = async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('activities')
          .select('*')
          .eq('user_id', userId)
          .order('start_date', { ascending: false })
          .limit(10)

        if (!cancelled && data && !error) {
          setActivities(data)
        }
      } catch (err) {
        console.error('Lỗi tải hoạt động:', err)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchActivities()

    return () => {
      cancelled = true
    }
  }, [userId])

  if (loading) {
    return <div className="bg-surface border border-border rounded-2xl p-4 text-center text-fg-subtle text-xs">Đang tải hoạt động...</div>
  }

  if (activities.length === 0) {
    return <div className="bg-surface border border-border rounded-2xl p-4 text-center text-fg-subtle text-xs">Chưa có hoạt động nào gần đây.</div>
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 space-y-3 shadow-xl text-xs">
      <h4 className="font-bold text-fg-muted uppercase tracking-wider">🏃 Hoạt động gần đây</h4>
      <div className="space-y-2">
        {activities.map((act) => {
          const pace = paceOf(act.distance_m || act.distance || 0, act.time_s || act.moving_time || 0)
          return (
            <div key={act.id} className="bg-bg p-3 rounded-xl border border-border/80 flex items-center justify-between">
              <div>
                <p className="font-bold text-white">{act.name || 'Chạy bộ'}</p>
                <p className="text-xs text-fg-subtle">{new Date(act.start_date || act.created_at).toLocaleDateString('vi-VN')}</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-brand">{fmtKm(act.distance_m || act.distance || 0)} km</p>
                <p className="text-xs text-fg-muted">{fmtDuration(act.time_s || act.moving_time || 0)} • {fmtPace(pace)}/km</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
