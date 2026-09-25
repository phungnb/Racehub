'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CalendarDays, Check, Clock, Flag, MapPin, MoreHorizontal, ShieldOff, Timer, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ConfirmSheet, Field, LevelBadge, Sheet, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import {
  blockUser, inviteToRun, nearbyErrorMessage, reportUser, sendConnection, type NearbyRunner,
} from '../api/nearbyApi'
import { useNearbyClubs, useNearbyEvents, useNearbyMutation } from '../hooks/useNearby'
import { eventWhen, formatKm, formatPace, GOALS, REASONS, REPORT_REASONS, SLOTS } from '../model/nearby'

const LINKISH = /(https?:\/\/|www\.|\.com\b|\.vn\b|zalo|telegram|t\.me|fb\.com|facebook|\d{9,})/i

/** Thẻ một runner quanh đây: lý do hợp nhau, pace, khung giờ; kết nối → rủ chạy; chặn / báo cáo */
export function RunnerCard({ r }: { r: NearbyRunner }) {
  const [sheet, setSheet] = useState<'connect' | 'invite' | 'menu' | 'report' | 'block' | null>(null)
  const pace = formatPace(r.pace_s)
  const close = () => setSheet(null)

  return (
    <Card className="space-y-3">
      <div className="flex items-start gap-3">
        <Avatar src={r.avatar_url} name={r.name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate font-semibold">{r.name}</p>
            {r.level != null && <LevelBadge level={r.level} />}
          </div>
          <p className="flex items-center gap-1 text-sm text-fg-muted">
            <MapPin className="size-3.5 shrink-0" aria-hidden />{formatKm(r.km)}{r.area_label ? ` · ${r.area_label}` : ''}
          </p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-fg-subtle">
            {pace && <span className="inline-flex items-center gap-1"><Timer className="size-3" aria-hidden />{pace}</span>}
            {r.clubs > 0 && <span className="inline-flex items-center gap-1"><Users className="size-3" aria-hidden />{r.clubs} CLB chung</span>}
            {r.mutual > 0 && <span>{r.mutual} bạn chung</span>}
          </p>
        </div>
        <button type="button" onClick={() => setSheet('menu')} aria-label={`Tuỳ chọn với ${r.name}`}
          className="-mr-2 -mt-1 grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg">
          <MoreHorizontal className="size-5" aria-hidden />
        </button>
      </div>

      {r.reasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.reasons.map((x) => (
            <span key={x} className="inline-flex items-center gap-1 rounded-full bg-brand/12 px-2.5 py-1 text-[11px] font-semibold text-brand">
              <Check className="size-3" aria-hidden />{REASONS[x]}
            </span>
          ))}
        </div>
      )}
      {(r.goals.length > 0 || r.time_slots.length > 0) && (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
          {r.goals.length > 0 && <span className="inline-flex items-center gap-1"><Flag className="size-3" aria-hidden />{r.goals.map((g) => GOALS[g]).join(', ')}</span>}
          {r.time_slots.length > 0 && <span className="inline-flex items-center gap-1"><Clock className="size-3" aria-hidden />{r.time_slots.map((s) => SLOTS[s]).join(', ')}</span>}
        </p>
      )}
      {r.bio && <p className="text-sm">{r.bio}</p>}

      {r.connection === 'NONE' && <Button block variant="secondary" onClick={() => setSheet('connect')}><UserPlus className="size-4" aria-hidden />Kết nối</Button>}
      {r.connection === 'PENDING_OUT' && <Button block variant="secondary" disabled>Đã gửi lời mời · chờ trả lời</Button>}
      {r.connection === 'PENDING_IN' && (
        <Link href={routes.nearbyConnections} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand text-[15px] font-semibold text-brand-fg">
          <UserPlus className="size-4" aria-hidden />Trả lời lời mời kết nối
        </Link>
      )}
      {r.connection === 'CONNECTED' && <Button block onClick={() => setSheet('invite')}><CalendarDays className="size-4" aria-hidden />Rủ chạy</Button>}

      {sheet === 'connect' && <ConnectSheet r={r} onClose={close} />}
      {sheet === 'invite' && <InviteSheet userId={r.id} name={r.name} onClose={close} />}
      {sheet === 'report' && <ReportSheet userId={r.id} name={r.name} onClose={close} />}
      <BlockSheet userId={r.id} name={r.name} open={sheet === 'block'} onClose={close} />
      <Sheet open={sheet === 'menu'} onClose={close} title={r.name}>
        <div className="space-y-2">
          <Button block variant="secondary" onClick={() => setSheet('report')}><Flag className="size-4" aria-hidden />Báo cáo</Button>
          <Button block variant="danger" onClick={() => setSheet('block')}><ShieldOff className="size-4" aria-hidden />Chặn</Button>
          <p className="text-xs text-fg-muted">Chặn: hai bên không còn thấy nhau ở Quanh đây, huỷ kết nối và lời mời. Người kia không được báo.</p>
        </div>
      </Sheet>
    </Card>
  )
}

function ConnectSheet({ r, onClose }: { r: NearbyRunner; onClose: () => void }) {
  const [msg, setMsg] = useState('')
  const send = useNearbyMutation((m: string | null) => sendConnection(r.id, m))
  const bad = LINKISH.test(msg)
  const submit = () => send.mutate(msg.trim() || null, {
    onSuccess: (x) => { toast.success(x.status === 'ACCEPTED' ? `Đã kết nối với ${r.name}` : 'Đã gửi lời mời kết nối'); onClose() },
    onError: (e) => toast.error(nearbyErrorMessage(e)),
  })
  return (
    <Sheet open onClose={onClose} title={`Kết nối với ${r.name}`} description="Kết nối xong hai bạn rủ nhau vào buổi chạy của CLB — chưa có nhắn tin riêng."
      footer={<Button block loading={send.isPending} disabled={bad} onClick={submit}>Gửi lời mời</Button>}>
      <Field label="Lời chào (không bắt buộc)" htmlFor="nb-msg" error={bad ? 'Không ghi link, số điện thoại, Zalo / Telegram' : null} hint={`${msg.length}/140`}>
        <Textarea id="nb-msg" value={msg} maxLength={140} rows={3} onChange={(e) => setMsg(e.target.value)}
          placeholder="Chào bạn, mình hay chạy 6:00 quanh hồ, pace tầm 6:30. Cuối tuần chạy cùng nhé!" />
      </Field>
    </Sheet>
  )
}

/** Rủ người đã kết nối: vào buổi chạy công khai quanh đây hoặc vào CLB của mình */
export function InviteSheet({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const events = useNearbyEvents(20)
  const clubs = useNearbyClubs(50)
  const mine = (clubs.data ?? []).filter((c) => c.is_member)
  const [pick, setPick] = useState<{ eventId?: string; clubId?: string } | null>(null)
  const [note, setNote] = useState('')
  const invite = useNearbyMutation(() => inviteToRun(userId, pick!, note.trim() || null))
  const bad = LINKISH.test(note)
  const submit = () => invite.mutate(undefined, {
    onSuccess: () => { toast.success(`Đã rủ ${name}`, { description: 'Bạn ấy nhận thông báo kèm link buổi chạy.' }); onClose() },
    onError: (e) => toast.error(nearbyErrorMessage(e)),
  })
  const opt = (key: string, on: boolean, onClick: () => void, title: string, sub: string) => (
    <button key={key} type="button" aria-pressed={on} onClick={onClick}
      className={cn('w-full rounded-xl border p-3 text-left', on ? 'border-brand bg-brand/10' : 'border-border')}>
      <span className="block text-sm font-semibold">{title}</span>
      <span className="block text-xs text-fg-muted">{sub}</span>
    </button>
  )
  return (
    <Sheet open onClose={onClose} title={`Rủ ${name} chạy`} description="Gặp nhau ở buổi chạy nhóm nơi công cộng — an toàn hơn hẹn riêng."
      footer={<Button block disabled={!pick || bad} loading={invite.isPending} onClick={submit}>Gửi lời rủ</Button>}>
      <div className="space-y-4">
        <Field label="Buổi chạy công khai sắp tới">
          <div className="space-y-1.5">
            {events.isError ? <p className="text-sm text-fg-muted">Chọn khu vực ở Quanh đây để thấy buổi chạy công khai gần bạn.</p>
              : events.isPending ? <p className="text-sm text-fg-muted">Đang tải…</p>
              : (events.data ?? []).length === 0 ? <p className="text-sm text-fg-muted">Chưa có buổi chạy công khai quanh đây.</p>
              : (events.data ?? []).slice(0, 8).map((e) => opt(e.id, pick?.eventId === e.id, () => setPick({ eventId: e.id }), e.title,
                  `${eventWhen(e.starts_at)} · ${e.club_name}${e.km != null ? ` · ${String(e.km).replace('.', ',')} km` : ''}`))}
          </div>
        </Field>
        {mine.length > 0 && (
          <Field label="Hoặc rủ vào CLB của bạn">
            <div className="space-y-1.5">
              {mine.map((c) => opt(c.id, pick?.clubId === c.id, () => setPick({ clubId: c.id }), c.name, `${c.member_count ?? 0} thành viên${c.upcoming ? ` · ${c.upcoming} buổi sắp tới` : ''}`))}
            </div>
          </Field>
        )}
        <Field label="Lời nhắn (không bắt buộc)" htmlFor="nb-note" error={bad ? 'Không ghi link, số điện thoại, Zalo / Telegram' : null}>
          <Textarea id="nb-note" value={note} maxLength={140} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="Chạy cùng nhóm mình nhé!" />
        </Field>
      </div>
    </Sheet>
  )
}

export function ReportSheet({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const [reason, setReason] = useState<keyof typeof REPORT_REASONS | null>(null)
  const [note, setNote] = useState('')
  const [alsoBlock, setAlsoBlock] = useState(true)
  const send = useNearbyMutation(async () => {
    await reportUser(userId, reason!, note.trim() || null)
    if (alsoBlock) await blockUser(userId)
  })
  const submit = () => send.mutate(undefined, {
    onSuccess: () => { toast.success('Đã gửi báo cáo', { description: 'Quản trị viên sẽ xem xét. Cảm ơn bạn giữ cộng đồng an toàn.' }); onClose() },
    onError: (e) => toast.error(nearbyErrorMessage(e)),
  })
  return (
    <Sheet open onClose={onClose} title={`Báo cáo ${name}`} description="Người bị báo cáo không biết ai báo cáo."
      footer={<Button block variant="danger" disabled={!reason} loading={send.isPending} onClick={submit}>Gửi báo cáo</Button>}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          {(Object.keys(REPORT_REASONS) as (keyof typeof REPORT_REASONS)[]).map((k) => (
            <button key={k} type="button" aria-pressed={reason === k} onClick={() => setReason(k)}
              className={cn('w-full rounded-xl border p-3 text-left text-sm font-semibold', reason === k ? 'border-danger bg-danger/10' : 'border-border')}>
              {REPORT_REASONS[k]}
            </button>
          ))}
        </div>
        <Field label="Mô tả thêm (không bắt buộc)" htmlFor="nb-rep">
          <Textarea id="nb-rep" value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} className="size-5 accent-[var(--color-brand)]" />
          Chặn luôn người này
        </label>
      </div>
    </Sheet>
  )
}

function BlockSheet({ userId, name, open, onClose }: { userId: string; name: string; open: boolean; onClose: () => void }) {
  const block = useNearbyMutation(() => blockUser(userId))
  return (
    <ConfirmSheet open={open} onClose={onClose} title={`Chặn ${name}?`} confirmLabel="Chặn" loading={block.isPending}
      description="Hai bên không còn thấy nhau ở Quanh đây; kết nối và lời mời bị huỷ. Bỏ chặn trong mục Kết nối."
      onConfirm={() => block.mutate(undefined, { onSuccess: () => { toast.success(`Đã chặn ${name}`); onClose() }, onError: (e) => toast.error(nearbyErrorMessage(e)) })} />
  )
}
