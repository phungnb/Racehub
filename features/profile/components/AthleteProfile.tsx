'use client'

import { useEffect, useState } from 'react'
import {
  fmtDuration,
  fmtKm,
  fmtPace,
  getAthleteProfile,
  paceOf,
  type AthleteProfileData,
} from '../api/athleteApi'
import { GiftWall } from '@/features/game'
import ActivityHistory from './ActivityHistory'

/* ────────────────────────────────────────────────────────────
 * AthleteProfile – hồ sơ vận động viên (mở được từ bất kỳ đâu chỉ với userId)
 *  Đặt tại: features/profile/components/AthleteProfile.tsx
 * ──────────────────────────────────────────────────────────── */

interface Props {
  userId: string
  onClose: () => void
}

const TONES = [
  'from-brand to-amber-500',
  'from-indigo-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-violet-500 to-purple-600',
  'from-sky-500 to-cyan-600',
]

/** Avatar ảnh hoặc chữ cái đầu; dùng chung cho tìm kiếm & hồ sơ */
export function AthleteAvatar({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [url])

  if (url && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt=""
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full object-cover bg-surface-2"
        style={{ width: size, height: size }}
      />
    )
  }
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <span
      aria-hidden
      className={`shrink-0 rounded-full bg-gradient-to-br ${TONES[h % TONES.length]} text-white font-black flex items-center justify-center`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {name.trim().substring(0, 2).toUpperCase()}
    </span>
  )
}

type Period = 'week' | 'month' | 'year' | 'all'
const PERIODS: [Period, string][] = [
  ['week', 'Tuần này'],
  ['month', 'Tháng này'],
  ['year', 'Năm nay'],
  ['all', 'Tất cả'],
]

export default function AthleteProfile({ userId, onClose }: Props) {
  const [data, setData] = useState<AthleteProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [period, setPeriod] = useState<Period>('month')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getAthleteProfile(userId)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [userId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const name = data?.display_name || 'Runner'
  const st = data?.stats?.[period]
  const pace = st ? paceOf(st.distance_m, st.time_s) : null

  return (
    <div role="dialog" aria-modal="true" aria-label="Hồ sơ vận động viên" className="fixed inset-0 z-[60] bg-bg overflow-y-auto animate-fadeIn">
      <div className="max-w-md mx-auto min-h-full border-x border-border">
        <header className="sticky top-0 z-10 bg-bg/90 backdrop-blur-md border-b border-border px-4 py-3 flex items-center gap-3">
          <button
            onClick={onClose}
            aria-label="Quay lại"
            className="w-8 h-8 rounded-full bg-surface hover:bg-surface-2 border border-border text-fg flex items-center justify-center cursor-pointer"
          >
            ‹
          </button>
          <h2 className="text-sm font-bold text-white">Hồ sơ vận động viên</h2>
        </header>

        <div className="p-5 space-y-5 text-xs">
          {loading ? (
            <div className="space-y-4" aria-hidden>
              <div className="w-24 h-24 rounded-full bg-surface animate-pulse mx-auto" />
              <div className="h-4 w-40 rounded bg-surface animate-pulse mx-auto" />
              <div className="h-40 rounded-2xl bg-surface animate-pulse" />
            </div>
          ) : error || !data ? (
            <div className="bg-surface border border-border rounded-2xl p-8 text-center text-fg-muted">
              Không tải được hồ sơ này.
            </div>
          ) : (
            <>
              {/* Danh tính */}
              <div className="text-center space-y-2">
                <div className="flex justify-center">
                  <AthleteAvatar name={name} url={data.avatar_url} size={88} />
                </div>
                <h3 className="text-lg font-black text-white">{name}</h3>
                {data.can_view_profile && (
                  <>
                    {data.region && <p className="text-fg-muted">📍 {data.region}</p>}
                    <div className="flex justify-center gap-2 flex-wrap">
                      <span className="bg-surface border border-border rounded-full px-3 py-1 text-fg font-semibold">
                        Level {data.level ?? 1}
                      </span>
                      <span className="bg-surface border border-border rounded-full px-3 py-1 text-brand font-semibold">
                        ⚡ {(data.xp ?? 0).toLocaleString('vi-VN')} XP
                      </span>
                    </div>
                    {data.joined_at && (
                      <p className="text-[11px] text-fg-subtle">
                        Tham gia từ {new Date(data.joined_at).toLocaleDateString('vi-VN')}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Hồ sơ riêng tư */}
              {!data.can_view_profile && (
                <div className="bg-surface border border-border rounded-2xl p-6 text-center space-y-1">
                  <p className="text-sm font-bold text-fg">Hồ sơ riêng tư</p>
                  <p className="text-fg-subtle">Vận động viên này chỉ chia sẻ hồ sơ với một số người nhất định.</p>
                </div>
              )}

              {/* CLB */}
              {data.can_view_profile && !!data.clubs?.length && (
                <section aria-label="Câu lạc bộ" className="space-y-2">
                  <h4 className="text-[11px] font-bold text-fg-muted px-1">Câu lạc bộ</h4>
                  <div className="flex gap-2 flex-wrap">
                    {data.clubs.map((c) => (
                      <span key={c.id} className="flex items-center gap-2 bg-surface border border-border rounded-full pl-1 pr-3 py-1 text-fg font-semibold">
                        <AthleteAvatar name={c.name} url={c.avatar_url} size={22} />
                        {c.name}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Thống kê + hoạt động */}
              {data.can_view_profile &&
                (data.can_view_activities && st ? (
                  <>
                    <section aria-label="Thống kê" className="bg-surface border border-border rounded-2xl p-4 space-y-4 shadow-xl">
                      <div role="tablist" className="grid grid-cols-4 gap-1 bg-bg p-1 rounded-xl">
                        {PERIODS.map(([p, label]) => (
                          <button
                            key={p}
                            role="tab"
                            aria-selected={period === p}
                            onClick={() => setPeriod(p)}
                            className={`py-1.5 rounded-lg font-bold cursor-pointer transition-colors ${
                              period === p ? 'bg-brand text-brand-fg' : 'text-fg-muted hover:text-white'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      <div className="text-center">
                        <span className="text-4xl font-black text-white">{fmtKm(st.distance_m)}</span>
                        <span className="text-sm font-bold text-fg-muted ml-1.5">km</span>
                      </div>

                      <dl className="grid grid-cols-3 gap-2 text-center">
                        {[
                          ['Số buổi chạy', String(st.count)],
                          ['Thời gian', fmtDuration(st.time_s)],
                          ['Pace TB', `${fmtPace(pace)}/km`],
                        ].map(([k, v]) => (
                          <div key={k} className="bg-bg rounded-xl p-2.5">
                            <dt className="text-xs text-fg-subtle">{k}</dt>
                            <dd className="text-sm font-bold text-white mt-0.5">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>

                    <GiftWall userId={userId} />
                    <ActivityHistory userId={userId} />
                  </>
                ) : (
                  <div className="bg-surface border border-border rounded-2xl p-6 text-center space-y-1">
                    <p className="text-sm font-bold text-fg">Hoạt động không công khai</p>
                    <p className="text-fg-subtle">Vận động viên này không chia sẻ hoạt động với bạn.</p>
                  </div>
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
