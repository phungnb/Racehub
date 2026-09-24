'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Download, Moon, Send, Swords, Trophy, Users, Heart, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ErrorState, Skeleton, SwitchRow } from '@/shared/ui'
import { useInstallAction } from '@/features/pwa'
import { getPushSettings, pushErrorMessage, sendTestPush, updatePushSettings, type PushPrefs, type PushSettings } from '../api/pushApi'
import { usePush, pushKeys } from '../hooks/usePush'
import { QUIET_HOURS } from '../model/push'

const CATEGORIES: { key: 'club' | 'challenge' | 'social' | 'game'; label: string; desc: string; icon: typeof Users }[] = [
  { key: 'club', label: 'CLB', desc: 'Buổi chạy, thu quỹ, bình chọn, thông báo, nhắc tên', icon: Users },
  { key: 'challenge', label: 'Thử thách', desc: 'Thử thách mới, kết quả, sắp hết hạn', icon: Swords },
  { key: 'social', label: 'Cổ vũ & bình luận', desc: 'Khi có người cổ vũ hoặc bình luận bài của bạn', icon: Heart },
  { key: 'game', label: 'Thành tích', desc: 'Huy hiệu mới, lên cấp, league', icon: Trophy },
]

/** Cài đặt "Thông báo & ứng dụng": cài app, bật push trên thiết bị này, chọn loại thông báo, giờ yên lặng */
export function PushSettingsCard() {
  const q = useQuery({ queryKey: pushKeys.settings, queryFn: getPushSettings })
  return (
    <Card className="space-y-1">
      <InstallRow />
      <DeviceRow configured={q.data?.configured ?? true} />
      {q.isPending ? <Skeleton className="h-64" />
        : q.isError ? <ErrorState message={pushErrorMessage(q.error)} onRetry={() => void q.refetch()} />
        : <Preferences key={JSON.stringify(q.data)} settings={q.data} />}
    </Card>
  )
}

function InstallRow() {
  const { state, install, sheet } = useInstallAction()
  if (state.installed) return null
  return (
    <div className="flex items-center gap-3 border-b border-border pb-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand"><Download className="size-[18px]" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Cài RaceHub lên màn hình chính</span>
        <span className="block text-xs text-fg-muted">Mở như app; iPhone cần cài để nhận thông báo</span>
      </span>
      <Button size="sm" onClick={() => void install()}>Cài</Button>
      {sheet}
    </div>
  )
}

function DeviceRow({ configured }: { configured: boolean }) {
  const push = usePush()
  const { install, sheet } = useInstallAction()
  const [busy, setBusy] = useState(false)
  const test = useMutation({ mutationFn: sendTestPush,
    onSuccess: () => toast.success('Đã gửi. Thông báo sẽ hiện sau vài giây.'), onError: (e) => toast.error(pushErrorMessage(e)) })

  const toggle = async (on: boolean) => {
    setBusy(true)
    try {
      if (!on) { await push.disable(); toast.success('Đã tắt thông báo trên thiết bị này'); return }
      const ok = await push.enable()
      if (ok) toast.success('Đã bật thông báo trên thiết bị này')
      else toast.error('Bạn chưa cho phép thông báo.')
    } catch (e) {
      toast.error(pushErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const note = (text: string, action?: React.ReactNode) => (
    <div className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-xs text-fg-muted">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="flex-1">{text}{action}</span>
    </div>
  )

  return (
    <div className="space-y-2 border-b border-border pb-3 pt-1">
      <SwitchRow icon={BellRing} label="Thông báo trên thiết bị này" checked={!!push.subscribed}
        description={push.subscribed ? 'Đang bật — kể cả khi không mở app' : 'Nhận nhắc buổi chạy, thu quỹ, thử thách'}
        disabled={busy || push.support !== 'ok' || push.subscribed === null || (push.permission === 'denied' && !push.subscribed)}
        onChange={(v) => void toggle(v)} />
      {push.support === 'ios-install' && note('Trên iPhone/iPad, hãy cài RaceHub lên màn hình chính rồi mở từ biểu tượng đó để bật thông báo (iOS 16.4 trở lên). ',
        <button type="button" className="font-semibold text-brand underline" onClick={() => void install()}>Xem cách cài</button>)}
      {push.support === 'unsupported' && note('Trình duyệt này không hỗ trợ thông báo đẩy. Hãy dùng Chrome, Edge, Firefox hoặc Safari mới.')}
      {push.support === 'no-key' && note('Máy chủ chưa bật thông báo đẩy (thiếu khóa VAPID). Báo quản trị viên.')}
      {push.support === 'dev' && note('Thông báo đẩy chỉ hoạt động ở bản đã deploy (không chạy với next dev).')}
      {push.support === 'ok' && push.permission === 'denied' && note('Bạn đã chặn thông báo cho RaceHub. Mở cài đặt trang của trình duyệt → Thông báo → Cho phép, rồi quay lại đây.')}
      {push.subscribed && !configured && note('Máy chủ chưa cấu hình gửi push nên chưa nhận được thông báo. Báo quản trị viên.')}
      {push.subscribed && (
        <Button size="sm" variant="secondary" loading={test.isPending} onClick={() => test.mutate()}><Send className="size-4" aria-hidden />Gửi thử</Button>
      )}
      {sheet}
    </div>
  )
}

function Preferences({ settings }: { settings: PushSettings }) {
  const qc = useQueryClient()
  const [p, setP] = useState<PushPrefs>(() => ({
    club: settings.club, social: settings.social, challenge: settings.challenge, game: settings.game,
    quiet: settings.quiet, quiet_from: settings.quiet_from, quiet_to: settings.quiet_to,
  }))
  const save = useMutation({
    mutationFn: updatePushSettings,
    onSuccess: (d) => qc.setQueryData(pushKeys.settings, d),
    onError: (e) => { toast.error(pushErrorMessage(e)); void qc.invalidateQueries({ queryKey: pushKeys.settings }) },
  })
  // Lưu ngay mỗi lần đổi (không cần nút Lưu)
  const set = (patch: Partial<PushPrefs>) => { const next = { ...p, ...patch }; setP(next); save.mutate(next) }

  const hourSelect = (id: string, value: number, onChange: (v: number) => void) => (
    <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))} disabled={!p.quiet}
      className="h-10 rounded-xl border border-border bg-bg px-2 font-mono text-sm disabled:opacity-50">
      {QUIET_HOURS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
    </select>
  )

  return (
    <div className="pt-2">
      <p className="pb-1 text-xs font-semibold text-fg-subtle">Nhận thông báo về (mọi thiết bị)</p>
      {CATEGORIES.map((c) => (
        <SwitchRow key={c.key} icon={c.icon} label={c.label} description={c.desc} checked={p[c.key]} onChange={(v) => set({ [c.key]: v })} />
      ))}
      <div className="mt-2 border-t border-border pt-2">
        <SwitchRow icon={Moon} label="Giờ yên lặng" checked={p.quiet} onChange={(v) => set({ quiet: v })}
          description="Không rung máy ban đêm; thông báo vẫn nằm trong chuông" />
        <div className="flex items-center gap-2 pl-12 text-sm text-fg-muted">
          <label htmlFor="quiet-from">Từ</label>{hourSelect('quiet-from', p.quiet_from, (v) => set({ quiet_from: v }))}
          <label htmlFor="quiet-to">đến</label>{hourSelect('quiet-to', p.quiet_to, (v) => set({ quiet_to: v }))}
        </div>
      </div>
    </div>
  )
}
