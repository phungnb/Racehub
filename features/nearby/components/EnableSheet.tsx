'use client'

import { useState } from 'react'
import Link from 'next/link'
import { EyeOff, Lock, MapPin, ShieldCheck, Timer } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, Sheet, SwitchRow, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { nearbyErrorMessage, setDiscovery, setPresence, type Discovery, type DiscoveryInput, type Goal, type Purpose, type Slot, type Visibility } from '../api/nearbyApi'
import { useNearbyMutation } from '../hooks/useNearby'
import { GOALS, PURPOSES, SLOTS, VISIBILITY } from '../model/nearby'
import { LocationPicker, type PickedPlace } from './LocationPicker'

function Chips<T extends string>({ value, options, onChange, multi = true }: { value: T[]; options: Record<T, string>; onChange: (v: T[]) => void; multi?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(options) as T[]).map((k) => {
        const on = value.includes(k)
        return (
          <button key={k} type="button" aria-pressed={on} onClick={() => onChange(multi ? (on ? value.filter((x) => x !== k) : [...value, k]) : [k])}
            className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold', on ? 'border-brand bg-brand/15 text-fg' : 'border-border text-fg-muted')}>
            {options[k]}
          </button>
        )
      })}
    </div>
  )
}

/** Tuỳ chọn hiển thị (dùng chung cho bật lần đầu và Cài đặt Quanh đây) */
export function PrefsForm({ value, onChange }: { value: DiscoveryInput; onChange: (v: DiscoveryInput) => void }) {
  return (
    <div className="space-y-4">
      <Field label="Ai thấy tôi">
        <div className="space-y-1.5">
          {(Object.keys(VISIBILITY) as Visibility[]).map((k) => (
            <button key={k} type="button" aria-pressed={value.visible_to === k} onClick={() => onChange({ ...value, visible_to: k })}
              className={cn('w-full rounded-xl border p-3 text-left', value.visible_to === k ? 'border-brand bg-brand/10' : 'border-border')}>
              <span className="block text-sm font-semibold">{VISIBILITY[k].label}{k === 'VERIFIED' && <span className="ml-1.5 text-[11px] text-brand">mặc định</span>}</span>
              <span className="block text-xs text-fg-muted">{VISIBILITY[k].hint}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Mục đích"><Chips value={(value.purposes ?? []) as Purpose[]} options={PURPOSES} onChange={(v) => onChange({ ...value, purposes: v })} /></Field>
      <Field label="Mục tiêu"><Chips value={(value.goals ?? []) as Goal[]} options={GOALS} onChange={(v) => onChange({ ...value, goals: v })} /></Field>
      <Field label="Hay chạy lúc"><Chips value={(value.time_slots ?? []) as Slot[]} options={SLOTS} onChange={(v) => onChange({ ...value, time_slots: v })} /></Field>
      <SwitchRow checked={value.share_pace ?? true} onChange={(on) => onChange({ ...value, share_pace: on })}
        label="Chia sẻ pace điển hình" description="Trung vị pace 28 ngày gần nhất — để ghép người chạy hợp nhau" />
      <Field label="Giới thiệu ngắn (không bắt buộc)" htmlFor="nb-bio" hint={`${(value.bio ?? '').length}/140 · không ghi số điện thoại, địa chỉ`}>
        <Textarea id="nb-bio" value={value.bio ?? ''} maxLength={140} onChange={(e) => onChange({ ...value, bio: e.target.value })} placeholder="Chạy chậm, thích long run cuối tuần quanh hồ." />
      </Field>
    </div>
  )
}

/** Bật Quanh đây lần đầu: 1) cam kết quyền riêng tư + đồng ý → 2) tuỳ chọn → 3) vị trí gần đúng */
export function EnableSheet({ me, open, onClose }: { me: Discovery; open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(me.enabled ? 3 : 1)
  const [agree, setAgree] = useState(false)
  const [prefs, setPrefs] = useState<DiscoveryInput>({ visible_to: me.visible_to, purposes: me.purposes, goals: me.goals, time_slots: me.time_slots, share_pace: me.share_pace, bio: me.bio })
  const enable = useNearbyMutation((p: DiscoveryInput) => setDiscovery(p))
  const place = useNearbyMutation((p: PickedPlace) => setPresence(p.lat, p.lng, p.source, p.area, p.hours))

  const submitPrefs = () => enable.mutate({ ...prefs, enabled: true, consent: true }, {
    onSuccess: () => setStep(3), onError: (e) => toast.error(nearbyErrorMessage(e)),
  })
  const submitPlace = (p: PickedPlace) => place.mutate(p, {
    onSuccess: () => { toast.success('Đã bật Quanh đây', { description: 'Bạn có thể tắt hoặc ẩn mình bất cứ lúc nào.' }); onClose() },
    onError: (e) => toast.error(nearbyErrorMessage(e)),
  })

  return (
    <Sheet open={open} onClose={onClose} title={step === 1 ? 'Runner quanh đây' : step === 2 ? 'Bạn muốn gặp ai?' : 'Khu vực bạn hay chạy'}
      description={`Bước ${step}/3`}
      footer={step === 1 ? <Button block disabled={!agree || !me.eligible} onClick={() => setStep(2)}>Tiếp tục</Button>
        : step === 2 ? <Button block loading={enable.isPending} onClick={submitPrefs}>Lưu & chọn khu vực</Button> : undefined}>
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">Tìm người chạy <b>cùng pace, cùng giờ, cùng mục tiêu</b> gần bạn, buổi chạy công khai và CLB quanh khu vực.</p>
          <ul className="space-y-2.5 text-sm">
            <li className="flex gap-2.5"><MapPin className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden /><span>Chỉ lưu <b>vùng ~1 km</b> bạn chọn — không lưu điểm chính xác, không lấy từ GPS bài chạy, không theo dõi khi bạn đang chạy.</span></li>
            <li className="flex gap-2.5"><Lock className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden /><span>Người khác chỉ thấy <b>tên gọi + chữ cái đầu họ</b> và <b>khoảng cách ước chừng</b> (đã làm tròn, có sai số).</span></li>
            <li className="flex gap-2.5"><Timer className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden /><span>Vị trí <b>tự hết hạn</b> sau 24 giờ / 7 / 30 ngày. Tắt tính năng = xoá vị trí ngay.</span></li>
            <li className="flex gap-2.5"><EyeOff className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden /><span>Chọn <b>ai thấy bạn</b>, chặn / báo cáo bất kỳ ai, ẩn mình một chạm.</span></li>
            <li className="flex gap-2.5"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden /><span>Chỉ runner có <b>≥ 3 bài chạy hợp lệ</b> mới bật được (chống tài khoản ảo). Chưa có nhắn tin riêng — kết nối xong thì <b>rủ nhau vào buổi chạy</b>.</span></li>
          </ul>
          {!me.eligible && (
            <p className="rounded-xl bg-coin/10 p-3 text-sm text-coin">Bạn mới có {me.valid_runs}/3 bài chạy hợp lệ. Chạy thêm {3 - me.valid_runs} buổi nữa để bật Quanh đây.</p>
          )}
          <label className="flex items-start gap-2.5 rounded-xl border border-border p-3 text-sm">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--color-brand)]" />
            <span>Tôi đồng ý cho RaceHub xử lý <b>vị trí gần đúng</b> của tôi cho tính năng Quanh đây như trên (xem <Link href={routes.privacy} className="text-brand underline" target="_blank">Chính sách quyền riêng tư</Link>). Tôi có thể rút lại đồng ý bất cứ lúc nào.</span>
          </label>
        </div>
      )}
      {step === 2 && <PrefsForm value={prefs} onChange={setPrefs} />}
      {step === 3 && <LocationPicker initialArea={me.presence?.area_label} onPick={submitPlace} busy={place.isPending} />}
    </Sheet>
  )
}
