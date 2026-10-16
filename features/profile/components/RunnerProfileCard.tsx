'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { Card, Skeleton } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import { fmtDuration, fmtKm, fmtPace, getAthleteProfile, paceOf } from '../api/athleteApi'
import { getMyLongBests, getMyProfile, type LongBest } from '../api/profileApi'
import { myProfileKey } from '../hooks/useRefreshProfile'
import { ageInfo } from '../model/profileForm'

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="truncate text-sm font-semibold">{value}</p>
    </div>
  )
}

function BestList({ title, rows }: { title: string; rows: LongBest[] }) {
  if (!rows.length) return null
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-bold">{title} · {rows.length} lần</p>
      <ol className="max-h-56 space-y-1 overflow-y-auto">
        {rows.map((b, i) => (
          <li key={b.activity_id} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-sm">
            <span className={i === 0 ? 'w-5 text-center font-mono text-xs font-bold text-medal-gold' : 'w-5 text-center font-mono text-xs text-fg-subtle'}>{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{new Date(b.at).toLocaleDateString('vi-VN')} · {b.km.toLocaleString('vi-VN')} km</span>
            <span className="font-mono tabular font-bold">{fmtDuration(b.best_s)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Hồ sơ runner trong tab Nhân vật của trang Tôi: thông tin cơ thể, thành tích tổng và CLB đang tham gia */
export function RunnerProfileCard({ userId }: { userId: string }) {
  const me = useQuery({ queryKey: myProfileKey, queryFn: getMyProfile })
  const ath = useQuery({ queryKey: ['athlete', userId], queryFn: () => getAthleteProfile(userId) })
  // Chưa chạy migration 017200 thì bỏ qua mục này, không làm hỏng cả thẻ
  const bests = useQuery({ queryKey: ['my-long-bests'], queryFn: getMyLongBests, retry: false })
  if (me.isPending || ath.isPending) return <Skeleton className="h-56" />
  const p = me.data
  const a = ath.data
  const all = a?.stats?.all
  const year = a?.stats?.year
  const age = p?.birth_date ? ageInfo(p.birth_date) : null
  const bmi = p?.height_cm && p?.weight_kg ? p.weight_kg / (p.height_cm / 100) ** 2 : null
  const dash = '—'
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-sm font-bold">Hồ sơ runner</h2>
        <Link href={routes.settings} className="inline-flex items-center gap-1 text-xs font-semibold text-brand"><Pencil className="size-3.5" aria-hidden />Chỉnh sửa</Link>
      </div>
      {p?.bio && <p className="text-sm text-fg-muted">{p.bio}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Fact label="Giới tính" value={p?.gender === 'male' ? 'Nam' : p?.gender === 'female' ? 'Nữ' : dash} />
        <Fact label="Tuổi" value={age ? `${age.age} · ${age.group}` : dash} />
        <Fact label="Khu vực" value={a?.region || dash} />
        <Fact label="Chiều cao" value={p?.height_cm ? `${p.height_cm} cm` : dash} />
        <Fact label="Cân nặng" value={p?.weight_kg ? `${p.weight_kg} kg` : dash} />
        <Fact label="BMI" value={bmi ? bmi.toFixed(1) : dash} />
      </div>
      <div className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border text-center">
        <div className="px-2 py-2.5"><p className="font-mono tabular text-lg font-bold">{fmtKm(all?.distance_m)}</p><p className="text-[11px] text-fg-muted">km tổng</p></div>
        <div className="px-2 py-2.5"><p className="font-mono tabular text-lg font-bold">{all?.count ?? 0}</p><p className="text-[11px] text-fg-muted">buổi chạy</p></div>
        <div className="px-2 py-2.5"><p className="font-mono tabular text-lg font-bold">{all ? fmtPace(paceOf(all.distance_m, all.time_s)) : dash}</p><p className="text-[11px] text-fg-muted">pace TB /km</p></div>
      </div>
      {year && <p className="text-xs text-fg-muted">Năm nay: <b className="font-mono text-fg">{fmtKm(year.distance_m)} km</b> · {year.count} buổi</p>}
      {(bests.data?.fm.length || bests.data?.hm.length) ? (
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Thành tích cá nhân</p>
          <BestList title="Full Marathon" rows={bests.data.fm} />
          <BestList title="Half Marathon" rows={bests.data.hm} />
        </div>
      ) : null}
      {!!a?.clubs?.length && (
        <p className="text-xs text-fg-muted">CLB: {a.clubs.map((c) => c.name).join(', ')}</p>
      )}
      {a?.joined_at && <p className="text-xs text-fg-subtle">Tham gia từ {new Date(a.joined_at).toLocaleDateString('vi-VN')}</p>}
    </Card>
  )
}
