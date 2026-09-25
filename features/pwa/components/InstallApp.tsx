'use client'

import { useState, useSyncExternalStore } from 'react'
import { Download, MoreVertical, Share, SquarePlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { ICONS } from '@/shared/config/brand'
import { Button, Card, Sheet } from '@/shared/ui'
import { isNativeApp } from '@/shared/lib/native'
import {
  canPromptInstall, detectPlatform, dismissInstall, installDismissed, isIosSafari, isStandalone, promptInstall, subscribeInstall,
  type Platform,
} from '../model/pwa'

type InstallState = { installed: boolean; canPrompt: boolean; platform: Platform; iosSafari: boolean }
const SERVER: InstallState = { installed: true, canPrompt: false, platform: 'desktop', iosSafari: false }
let cache: InstallState = SERVER
const snapshot = (): InstallState => {
  const next: InstallState = {
    installed: isStandalone() || isNativeApp(), canPrompt: canPromptInstall(),
    platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints), iosSafari: isIosSafari(navigator.userAgent),
  }
  if (JSON.stringify(next) !== JSON.stringify(cache)) cache = next
  return cache
}

/** Trạng thái cài app; `installed` = đang chạy dạng app (từ màn hình chính) */
export function useInstallState() {
  return useSyncExternalStore(subscribeInstall, snapshot, () => SERVER)
}

/** Nút/luồng cài app: Android & máy tính mở hộp thoại của trình duyệt; iOS hiện hướng dẫn 3 bước */
export function useInstallAction() {
  const s = useInstallState()
  const [guide, setGuide] = useState(false)
  const install = async () => {
    if (s.canPrompt) {
      if (await promptInstall()) toast.success('Đã cài RaceHub lên màn hình chính')
      return
    }
    setGuide(true)
  }
  const sheet = <InstallGuide open={guide} onClose={() => setGuide(false)} platform={s.platform} iosSafari={s.iosSafari} />
  return { state: s, install, sheet }
}

function InstallGuide({ open, onClose, platform, iosSafari }: { open: boolean; onClose: () => void; platform: Platform; iosSafari: boolean }) {
  const steps = platform === 'ios'
    ? iosSafari
      ? [
          { icon: Share, text: <>Bấm nút <b>Chia sẻ</b> ở thanh dưới của Safari</> },
          { icon: SquarePlus, text: <>Kéo xuống, chọn <b>Thêm vào MH chính</b></> },
          { icon: Download, text: <>Bấm <b>Thêm</b>. Mở RaceHub từ biểu tượng mới để nhận thông báo</> },
        ]
      : [{ icon: Share, text: <>Trên iPhone, hãy mở <b>racehub</b> bằng <b>Safari</b> rồi làm theo hướng dẫn cài</> }]
    : [
        { icon: MoreVertical, text: <>Mở menu <b>⋮</b> của trình duyệt</> },
        { icon: Download, text: <>Chọn <b>Cài đặt ứng dụng</b> hoặc <b>Thêm vào màn hình chính</b></> },
      ]
  return (
    <Sheet open={open} onClose={onClose} title="Cài RaceHub lên màn hình chính" description="Mở nhanh như app, toàn màn hình, nhận thông báo">
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-3 rounded-2xl border border-border p-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand"><s.icon className="size-5" aria-hidden /></span>
            <span className="text-sm"><span className="mr-1 font-mono text-fg-subtle">{i + 1}.</span>{s.text}</span>
          </li>
        ))}
      </ol>
    </Sheet>
  )
}

/** Thẻ gợi ý cài app ở Trang chủ; ẩn khi đã cài hoặc người dùng bấm "Để sau" (14 ngày) */
export function InstallCard() {
  const { state, install, sheet } = useInstallAction()
  const [hidden, setHidden] = useState(() => typeof window === 'undefined' || installDismissed(Date.now()))
  if (state.installed || hidden) return null
  return (
    <Card className="relative flex items-center gap-3 border-brand/30 bg-gradient-to-br from-brand/10 to-transparent">
      {/* eslint-disable-next-line @next/next/no-img-element -- icon tĩnh của app */}
      <img src={ICONS.any192} alt="" className="size-12 shrink-0 rounded-2xl" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Cài RaceHub như một app</p>
        <p className="text-xs text-fg-muted">Mở nhanh từ màn hình chính và nhận thông báo buổi chạy, thu quỹ</p>
        <Button size="sm" className="mt-2" onClick={() => void install()}><Download className="size-4" aria-hidden />Cài ngay</Button>
      </div>
      <button type="button" aria-label="Để sau" onClick={() => { dismissInstall(Date.now()); setHidden(true) }}
        className="absolute right-1 top-1 grid size-9 place-items-center rounded-full text-fg-subtle hover:bg-surface-2">
        <X className="size-4" aria-hidden />
      </button>
      {sheet}
    </Card>
  )
}
