'use client'

import { useEffect, useState } from 'react'
import { Button, Card, Field, Input } from '@/shared/ui'
import {
  DEFAULT_SETTINGS,
  getMySettings,
  saveMySettings,
  type AthleteSettings,
  type Visibility,
} from '../api/athleteApi'

// Quyền riêng tư: khu vực + ai được xem hồ sơ / hoạt động / đường chạy (dùng trong màn Cài đặt)

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
    <Field label={label} htmlFor={id} hint={hint}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as Visibility)}
        className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px] text-fg outline-none focus:border-brand">
        {OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </Field>
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

  if (loading) return <div className="h-80 animate-pulse rounded-2xl bg-surface" aria-hidden />

  return (
    <Card className="space-y-4">
      <Field label="Khu vực" htmlFor="region" hint="Chỉ nên ghi tỉnh hoặc thành phố, không ghi địa chỉ nhà.">
        <Input id="region" list="region-list" value={s.region ?? ''} maxLength={40} placeholder="Ví dụ: Đà Nẵng"
          onChange={(e) => set('region', e.target.value)} />
        <datalist id="region-list">
          {REGION_SUGGESTIONS.map((r) => <option key={r} value={r} />)}
        </datalist>
      </Field>

      <Row id="pv-profile" label="Ai xem được hồ sơ" hint="Level, khu vực, CLB, giới thiệu. Tên và ảnh luôn hiển thị."
        value={s.profile_visibility} onChange={(v) => set('profile_visibility', v)} />
      <Row id="pv-acts" label="Ai xem được hoạt động" hint="Quãng đường, thời gian, pace của các bài chạy."
        value={s.activity_visibility} onChange={(v) => set('activity_visibility', v)} />
      <Row id="pv-map" label="Ai xem được đường chạy" hint="Bản đồ lộ trình của từng bài chạy."
        value={s.map_visibility} onChange={(v) => set('map_visibility', v)} />

      {mapShared && (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-coin/40 bg-coin/10 p-3">
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-brand)]" />
          <span className="text-xs text-fg">
            Tôi hiểu đường chạy thường bắt đầu và kết thúc gần nơi ở hoặc nơi làm việc, và đồng ý chia sẻ với nhóm đã chọn.
          </span>
        </label>
      )}

      {msg && <p role="status" className={msg.tone === 'ok' ? 'text-sm text-brand' : 'text-sm text-danger'}>{msg.text}</p>}

      <Button block onClick={save} disabled={!canSave} loading={saving}>Lưu quyền riêng tư</Button>
    </Card>
  )
}
