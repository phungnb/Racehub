'use client'

import { useEffect, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  getMySettings,
  saveMySettings,
  type AthleteSettings,
  type Visibility,
} from '../api/athleteApi'

/* ────────────────────────────────────────────────────────────
 * PrivacySettings – vùng miền + ai được xem hồ sơ / hoạt động / bản đồ
 *  Đặt tại: features/profile/components/PrivacySettings.tsx
 *  Dùng trong ProfileTab:  <PrivacySettings userId={profile.id} />
 * ──────────────────────────────────────────────────────────── */

const OPTIONS: [Visibility, string][] = [
  ['PUBLIC', 'Mọi người'],
  ['CLUB', 'Thành viên cùng CLB'],
  ['PRIVATE', 'Chỉ mình tôi'],
]

const REGION_SUGGESTIONS = [
  'Hà Nội', 'TP. Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ', 'Huế',
  'Nha Trang', 'Đà Lạt', 'Vũng Tàu', 'Biên Hòa',
]

function Row({
  id, label, hint, value, onChange,
}: {
  id: string
  label: string
  hint: string
  value: Visibility
  onChange: (v: Visibility) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-bold text-fg">{label}</label>
      <p className="text-[11px] text-fg-subtle mb-1.5">{hint}</p>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as Visibility)}
        className="w-full bg-bg border border-border rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-brand"
      >
        {OPTIONS.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </div>
  )
}

export default function PrivacySettings({ userId }: { userId: string }) {
  const [s, setS] = useState<AthleteSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [understood, setUnderstood] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    getMySettings(userId)
      .then((d) => {
        if (cancelled) return
        setS(d)
        setUnderstood(!!d.consented_at)
      })
      .catch(() => !cancelled && setMsg({ tone: 'err', text: 'Không tải được cài đặt.' }))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [userId])

  const set = <K extends keyof AthleteSettings>(k: K, v: AthleteSettings[K]) => {
    setMsg(null)
    setS((prev) => ({ ...prev, [k]: v }))
  }

  const mapShared = s.map_visibility !== 'PRIVATE'
  const canSave = !saving && (!mapShared || understood)

  const save = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const next = { ...s, consented_at: mapShared ? s.consented_at ?? new Date().toISOString() : s.consented_at }
      await saveMySettings(userId, next)
      setS(next)
      setMsg({ tone: 'ok', text: 'Đã lưu cài đặt riêng tư.' })
    } catch {
      setMsg({ tone: 'err', text: 'Không lưu được. Thử lại sau.' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="h-48 rounded-2xl bg-surface animate-pulse" aria-hidden />

  return (
    <section aria-labelledby="privacy-title" className="bg-surface border border-border rounded-2xl p-4 space-y-4 shadow-xl">
      <h3 id="privacy-title" className="text-sm font-bold text-white">Quyền riêng tư</h3>

      <div>
        <label htmlFor="region" className="block text-xs font-bold text-fg">Khu vực</label>
        <p className="text-[11px] text-fg-subtle mb-1.5">Chỉ nên ghi tỉnh hoặc thành phố. Không ghi địa chỉ nhà.</p>
        <input
          id="region"
          list="region-list"
          value={s.region ?? ''}
          maxLength={40}
          onChange={(e) => set('region', e.target.value)}
          placeholder="Ví dụ: Đà Nẵng"
          className="w-full bg-bg border border-border rounded-xl px-3 py-2.5 text-xs text-white placeholder:text-fg-subtle outline-none focus:border-brand"
        />
        <datalist id="region-list">
          {REGION_SUGGESTIONS.map((r) => <option key={r} value={r} />)}
        </datalist>
      </div>

      <Row id="pv-profile" label="Ai xem được hồ sơ" hint="Tên, level, khu vực, CLB. Tên và ảnh luôn hiển thị."
        value={s.profile_visibility} onChange={(v) => set('profile_visibility', v)} />
      <Row id="pv-acts" label="Ai xem được hoạt động" hint="Quãng đường, thời gian, pace của các bài chạy."
        value={s.activity_visibility} onChange={(v) => set('activity_visibility', v)} />
      <Row id="pv-map" label="Ai xem được đường chạy" hint="Bản đồ lộ trình của từng bài chạy."
        value={s.map_visibility} onChange={(v) => set('map_visibility', v)} />

      {mapShared && (
        <label className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 cursor-pointer">
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            className="accent-brand mt-0.5"
          />
          <span className="text-[11px] text-amber-200">
            Tôi hiểu đường chạy thường bắt đầu và kết thúc gần nơi ở hoặc nơi làm việc, và đồng ý chia sẻ với nhóm đã chọn.
          </span>
        </label>
      )}

      {msg && (
        <p role="status" className={`text-xs ${msg.tone === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`}>
          {msg.text}
        </p>
      )}

      <button
        onClick={save}
        disabled={!canSave}
        className="w-full bg-brand hover:bg-brand-strong disabled:opacity-40 text-brand-fg font-black py-2.5 rounded-xl text-xs cursor-pointer"
      >
        {saving ? 'Đang lưu…' : 'Lưu cài đặt'}
      </button>
    </section>
  )
}
