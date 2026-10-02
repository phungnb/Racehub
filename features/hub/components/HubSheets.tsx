'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button, Field, Input, Sheet, SwitchRow, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { PROVINCES } from '@/shared/lib/provinces'
import { GOALS, PURPOSES, SLOTS, setDiscovery, type DiscoveryInput, type Goal, type Purpose, type Slot } from '@/features/nearby'
import { createHubPost, hubErrorMessage, type MyHub, type NewPost, type PostKind } from '../api/hubApi'
import { hasContactOrLink, parsePace, POST_KINDS } from '../model/hub'
import { useHubMutation } from './hubHooks'

function Chips<T extends string>({ value, options, onChange }: { value: T[]; options: Record<T, string>; onChange: (v: T[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(options) as T[]).map((k) => {
        const on = value.includes(k)
        return (
          <button key={k} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])}
            className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold', on ? 'border-brand bg-brand/15 text-fg' : 'border-border text-fg-muted')}>
            {options[k]}
          </button>
        )
      })}
    </div>
  )
}

export const HUB_TERMS = 'Hồ sơ Hội quán (tên, ảnh, tỉnh / thành, giới thiệu, mục tiêu, khung giờ, pace điển hình, thành tích ước tính và số km từ ' +
  'các bài chạy bạn ĐÃ chia sẻ) hiện với mọi runner đã đăng nhập RaceHub. Không hiện vị trí, tuyến chạy. Rời Hội quán là ẩn ngay.'

/** Tham gia / sửa hồ sơ Hội quán */
export function JoinHubSheet({ me, onClose }: { me: MyHub; onClose: () => void }) {
  const [v, setV] = useState<DiscoveryInput>({
    province: me.province, headline: me.headline, bio: me.bio, goals: me.goals, time_slots: me.time_slots, purposes: me.purposes, share_pace: me.share_pace,
  })
  const [agree, setAgree] = useState(me.listed)
  const save = useHubMutation((p: DiscoveryInput) => setDiscovery(p))
  const warn = hasContactOrLink(`${v.headline ?? ''} ${v.bio ?? ''}`)
  const submit = () => save.mutate({ ...v, hub_listed: true, hub_consent: !me.listed ? true : undefined }, {
    onSuccess: () => { toast.success(me.listed ? 'Đã lưu hồ sơ' : 'Chào mừng tới Hội quán!', { description: me.listed ? undefined : 'Đăng bài đầu tiên để làm quen nhé.' }); onClose() },
    onError: (e) => toast.error(hubErrorMessage(e)),
  })
  return (
    <Sheet open onClose={onClose} title={me.listed ? 'Sửa hồ sơ Hội quán' : 'Tham gia Hội quán'} description="Runner khắp Việt Nam tìm thấy bạn theo tỉnh, pace, mục tiêu."
      footer={<Button block disabled={!agree || !me.eligible || warn} loading={save.isPending} onClick={submit}>{me.listed ? 'Lưu' : 'Tham gia'}</Button>}>
      <div className="space-y-4">
        {!me.eligible && (
          <p className="rounded-xl bg-coin/10 p-3 text-sm text-coin">Cần ít nhất 3 bài chạy hợp lệ (bạn có {me.valid_runs}). Chạy thêm {Math.max(0, 3 - me.valid_runs)} buổi nữa nhé — để Hội quán toàn runner thật.</p>
        )}
        <Field label="Tỉnh / thành bạn hay chạy" htmlFor="hub-prov">
          <select id="hub-prov" value={v.province ?? ''} onChange={(e) => setV({ ...v, province: e.target.value || null })}
            className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm">
            <option value="">— Chọn —</option>
            {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Một dòng giới thiệu" htmlFor="hub-head" hint={`${(v.headline ?? '').length}/80 · VD: "Tập HM sub 2, thích chạy sáng sớm"`}>
          <Input id="hub-head" value={v.headline ?? ''} maxLength={80} onChange={(e) => setV({ ...v, headline: e.target.value })} />
        </Field>
        <Field label="Mục tiêu"><Chips value={(v.goals ?? []) as Goal[]} options={GOALS} onChange={(x) => setV({ ...v, goals: x })} /></Field>
        <Field label="Hay chạy lúc"><Chips value={(v.time_slots ?? []) as Slot[]} options={SLOTS} onChange={(x) => setV({ ...v, time_slots: x })} /></Field>
        <Field label="Bạn đang tìm"><Chips value={(v.purposes ?? []) as Purpose[]} options={PURPOSES} onChange={(x) => setV({ ...v, purposes: x })} /></Field>
        <SwitchRow checked={v.share_pace ?? true} onChange={(on) => setV({ ...v, share_pace: on })}
          label="Hiện pace điển hình" description="Trung vị 28 ngày — giúp ghép người chạy hợp nhau" />
        <Field label="Giới thiệu thêm (không bắt buộc)" htmlFor="hub-bio" hint={`${(v.bio ?? '').length}/140`}>
          <Textarea id="hub-bio" value={v.bio ?? ''} maxLength={140} rows={3} onChange={(e) => setV({ ...v, bio: e.target.value })} />
        </Field>
        {warn && <p role="alert" className="text-xs text-danger">Không ghi số điện thoại, link, Zalo / Facebook — kết nối xong hai bạn nhắn tin trong RaceHub.</p>}
        {!me.listed && (
          <label className="flex items-start gap-2.5 rounded-xl border border-border p-3 text-sm">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--color-brand)]" />
            <span>{HUB_TERMS} (<Link href={routes.privacy} target="_blank" className="text-brand underline">Quyền riêng tư</Link>)</span>
          </label>
        )}
      </div>
    </Sheet>
  )
}

const NEAR_KINDS: PostKind[] = ['BUDDY', 'PACER']

/** Đăng bài Hội quán */
export function NewPostSheet({ me, onClose }: { me: MyHub; onClose: () => void }) {
  const [kind, setKind] = useState<PostKind>('BUDDY')
  const [body, setBody] = useState('')
  const [race, setRace] = useState('')
  const [meet, setMeet] = useState('')
  const [goal, setGoal] = useState<Goal | ''>('')
  const [pace, setPace] = useState('')
  const [province, setProvince] = useState(me.province ?? '')
  const [near, setNear] = useState(me.located)
  const create = useHubMutation((p: NewPost) => createHubPost(p))
  const k = POST_KINDS[kind]
  const paceS = pace.trim() ? parsePace(pace) : null
  const warn = hasContactOrLink(`${body} ${race}`)
  const invalid = body.trim().length < 5 || warn || (kind === 'RACE' && !race.trim()) || (!!pace.trim() && paceS == null)

  const submit = () => create.mutate({
    kind, body: body.trim(), province: province || null, goal: goal || null, pace_s: paceS,
    race_name: kind === 'RACE' ? race.trim() : null, meet_at: meet ? new Date(meet).toISOString() : null,
    near: NEAR_KINDS.includes(kind) && near,
  }, {
    onSuccess: (p) => {
      toast.success('Đã đăng bài', { description: p.near ? 'Runner quanh bạn đã được báo.' : 'Bài hiện 14 ngày hoặc tới ngày hẹn.' })
      onClose()
    },
    onError: (e) => toast.error(hubErrorMessage(e)),
  })

  return (
    <Sheet open onClose={onClose} title="Đăng bài Hội quán" description="Tối đa 5 bài / ngày · không ghi số điện thoại, link"
      footer={<Button block disabled={invalid} loading={create.isPending} onClick={submit}>Đăng</Button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-1.5 min-[400px]:grid-cols-5" role="radiogroup" aria-label="Loại bài">
          {(Object.keys(POST_KINDS) as PostKind[]).map((x) => (
            <button key={x} type="button" role="radio" aria-checked={kind === x} onClick={() => setKind(x)}
              className={cn('flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2 text-[11px] font-semibold', kind === x ? 'border-violet-400 bg-violet-500/15' : 'border-border text-fg-muted')}>
              <span className="text-lg" aria-hidden>{POST_KINDS[x].emoji}</span>{POST_KINDS[x].label}
            </button>
          ))}
        </div>
        <p className="text-xs text-fg-muted">{k.hint}</p>
        {kind === 'RACE' && (
          <Field label="Tên giải" htmlFor="hp-race">
            <Input id="hp-race" value={race} maxLength={80} onChange={(e) => setRace(e.target.value)} placeholder="VD: VnExpress Marathon Hà Nội 2026" />
          </Field>
        )}
        <Field label="Nội dung" htmlFor="hp-body" hint={`${body.length}/500`}>
          <Textarea id="hp-body" value={body} maxLength={500} rows={4} onChange={(e) => setBody(e.target.value)} placeholder={k.placeholder} />
        </Field>
        {warn && <p role="alert" className="text-xs text-danger">Bỏ số điện thoại / link / Zalo / Facebook — người quan tâm sẽ nhắn tin cho bạn trong RaceHub.</p>}
        {kind !== 'ASK' && kind !== 'SHARE' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={kind === 'RACE' ? 'Ngày giải' : 'Hẹn lúc'} htmlFor="hp-meet">
              <Input id="hp-meet" type="datetime-local" value={meet} onChange={(e) => setMeet(e.target.value)} />
            </Field>
            <Field label="Pace (phút/km)" htmlFor="hp-pace" error={pace.trim() && paceS == null ? 'VD: 5:30' : undefined}>
              <Input id="hp-pace" value={pace} inputMode="numeric" placeholder="6:00" onChange={(e) => setPace(e.target.value)} />
            </Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cự ly" htmlFor="hp-goal">
            <select id="hp-goal" value={goal} onChange={(e) => setGoal(e.target.value as Goal | '')} className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm">
              <option value="">— Không —</option>
              {(Object.keys(GOALS) as Goal[]).map((g) => <option key={g} value={g}>{GOALS[g]}</option>)}
            </select>
          </Field>
          <Field label="Tỉnh / thành" htmlFor="hp-prov">
            <select id="hp-prov" value={province} onChange={(e) => setProvince(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm">
              <option value="">— Toàn quốc —</option>
              {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>
        {NEAR_KINDS.includes(kind) && (
          me.located
            ? <SwitchRow checked={near} onChange={setNear} label="Gần tôi — báo runner quanh đây"
                description="Bài gắn khu vực ~1–2 km của bạn (không lộ vị trí chính xác) và báo cho tối đa 30 runner trong 10 km đang bật Quanh đây." />
            : <p className="rounded-xl bg-surface-2 p-3 text-xs text-fg-muted">Bật <Link href={routes.nearby} className="font-semibold text-brand">Quanh đây</Link> để bài rủ chạy tự báo cho runner gần bạn.</p>
        )}
      </div>
    </Sheet>
  )
}
