'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { ICONS } from '@/shared/config/brand'
import { MenuDrawer } from '@/features/help'
import { PaperDoll } from '@/features/character'

const SEEN_KEY = 'rh_intro_seen'
const noSubscribe = () => () => undefined
const readSeen = () => { try { return localStorage.getItem(SEEN_KEY) === '1' } catch { return false } }
const REGISTER = `${routes.login}?mode=register`
const AUTOPLAY_MS = 5000

interface Slide { key: string; kicker: string; title: string; text: string; visual: ReactNode }

const SLIDES: Slide[] = [
  {
    key: 'hero', kicker: 'RUN · CONNECT · EVOLVE', title: 'Biến mỗi km thành một cuộc chơi',
    text: 'Chạy bộ, lên cấp, đua cùng CLB và xây runner của riêng bạn.',
    visual: <Doll body="male_run" label="Nhân vật runner RaceHub" />,
  },
  {
    key: 'run', kicker: 'RUN', title: 'Mỗi km thật đều được tính',
    text: 'Chạy bằng app RaceHub hoặc kết nối Strava. Km hợp lệ thành XP, XP đưa bạn lên Level.',
    visual: (
      <div className="w-full max-w-[260px] space-y-3 text-center">
        <Chip big>🏃 5,0 km</Chip>
        <Arrow />
        <Chip big className="text-brand">⭐ +50 XP</Chip>
        <Arrow />
        <div className="rounded-2xl border border-border bg-surface p-3 text-left">
          <p className="text-xs font-semibold text-fg-muted">Level 2 → 3</p>
          <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full w-4/5 rounded-full bg-brand" /></div>
        </div>
      </div>
    ),
  },
  {
    key: 'connect', kicker: 'CONNECT', title: 'Chạy một mình, tiến bộ cùng CLB',
    text: 'Bảng tin, lịch chạy nhóm điểm danh QR, thử thách CLB và bảng xếp hạng tuần.',
    visual: (
      <div className="w-full max-w-[280px] space-y-2">
        {[['🥇', 'Minh Anh', '42,5 km'], ['🥈', 'Quốc Bảo', '38,1 km'], ['🥉', 'Thu Hà', '31,0 km']].map(([m, n, km]) => (
          <div key={n} className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5">
            <span className="text-xl" aria-hidden>{m}</span><span className="flex-1 font-semibold">{n}</span><span className="font-mono text-sm text-brand">{km}</span>
          </div>
        ))}
        <p className="pt-1 text-center text-xs text-fg-subtle">Ví dụ minh hoạ bảng xếp hạng CLB</p>
      </div>
    ),
  },
  {
    key: 'compete', kicker: 'COMPETE', title: 'Thử thách, giải chạy ảo, huy hiệu',
    text: 'Tham gia thử thách cá nhân, CLB hay cộng đồng. Hoàn thành để nhận BIB, chứng nhận và huy hiệu.',
    visual: (
      <div className="grid w-full max-w-[280px] grid-cols-3 gap-2 text-center">
        {[['🎯', 'Thử thách'], ['🏁', 'Giải ảo'], ['🎫', 'BIB'], ['🏅', 'Huy hiệu'], ['📜', 'Chứng nhận'], ['⚔️', 'CLB đấu CLB']].map(([i, t]) => (
          <div key={t} className="rounded-2xl border border-border bg-surface px-1 py-3">
            <p className="text-2xl" aria-hidden>{i}</p><p className="mt-1 text-[11px] font-semibold">{t}</p>
          </div>
        ))}
      </div>
    ),
  },
  {
    key: 'evolve', kicker: 'EVOLVE', title: 'Xây runner của riêng bạn',
    text: 'Phối đồ, mở khoá vật phẩm theo hành trình, nhận quà cổ vũ từ bạn bè. 8 cấp độ từ Tân Binh đến Đỉnh Cao.',
    visual: <Doll body="female_run" label="Nhân vật runner nữ" />,
  },
]

/** Màn giới thiệu trước khi đăng ký (người chưa đăng nhập mở app / vào trang chủ web) */
export function IntroScreen() {
  const router = useRouter()
  const params = useSearchParams()
  const track = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  // Đã xem một lần → vào thẳng đăng nhập (?intro=1 để xem lại). null = đang render trên máy chủ
  const seen = useSyncExternalStore(noSubscribe, readSeen, () => null)
  const skip = seen === true && params.get('intro') !== '1'
  const ready = seen !== null && !skip
  useEffect(() => { if (skip) router.replace(routes.login) }, [skip, router])

  const markSeen = () => { try { localStorage.setItem(SEEN_KEY, '1') } catch { /* bỏ qua */ } }
  const go = useCallback((i: number) => {
    const el = track.current
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const el = track.current
    if (!el) return
    const onScroll = () => setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [ready])

  // Tự chuyển thẻ; dừng khi người dùng chạm / tắt chuyển động
  useEffect(() => {
    if (!ready || paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = window.setTimeout(() => go(index + 1 < SLIDES.length ? index + 1 : 0), AUTOPLAY_MS)
    return () => window.clearTimeout(t)
  }, [index, paused, ready, go])

  if (!ready) return <div className="min-h-dvh bg-bg" />
  const last = index === SLIDES.length - 1

  return (
    <main className="mx-auto flex h-dvh max-w-md flex-col bg-bg pt-[env(safe-area-inset-top)]">
      <header className="flex h-14 shrink-0 items-center gap-1 px-2">
        <MenuDrawer />
        <p className="flex flex-1 items-center gap-2 text-lg font-extrabold tracking-wide">
          {/* eslint-disable-next-line @next/next/no-img-element -- biểu tượng tĩnh nhỏ */}
          <img src={ICONS.mark} alt="" width={26} height={26} className="size-[26px]" /><span>RACE<span className="text-brand">HUB</span></span>
        </p>
        <Link href={REGISTER} onClick={markSeen} className="min-h-11 content-center px-3 text-sm font-semibold text-fg-muted hover:text-fg">Bỏ qua</Link>
      </header>

      <div ref={track} onPointerDown={() => setPaused(true)} aria-roledescription="carousel" aria-label="Giới thiệu RaceHub"
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SLIDES.map((s, i) => (
          <section key={s.key} aria-roledescription="slide" aria-label={`${i + 1} / ${SLIDES.length}`}
            className="flex w-full shrink-0 snap-center flex-col px-6">
            <div className="flex min-h-0 flex-1 items-center justify-center py-4">{s.visual}</div>
            <div className="pb-4 text-center">
              <p className="text-xs font-bold tracking-[0.2em] text-brand">{s.kicker}</p>
              <h1 className="mt-2 text-[26px] font-extrabold leading-tight">{s.title}</h1>
              <p className="mx-auto mt-2 max-w-xs text-fg-muted">{s.text}</p>
            </div>
          </section>
        ))}
      </div>

      <div className="flex justify-center gap-1.5 py-3" role="tablist" aria-label="Chọn thẻ giới thiệu">
        {SLIDES.map((s, i) => (
          <button key={s.key} type="button" role="tab" aria-selected={i === index} aria-label={`Thẻ ${i + 1}`}
            onClick={() => { setPaused(true); go(i) }}
            className={cn('h-2 rounded-full transition-all', i === index ? 'w-6 bg-brand' : 'w-2 bg-surface-2')} />
        ))}
      </div>

      <div className="space-y-2 px-6 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <Link href={REGISTER} onClick={markSeen}
          className="flex min-h-13 items-center justify-center gap-1 rounded-2xl bg-brand text-base font-extrabold text-brand-fg shadow-lg shadow-brand/20">
          {last ? 'Bắt đầu chơi — miễn phí' : 'Đăng ký miễn phí'}<ChevronRight className="size-5" aria-hidden />
        </Link>
        <Link href={routes.login} onClick={markSeen} className="flex min-h-11 items-center justify-center text-sm text-fg-muted">
          Đã có tài khoản?&nbsp;<span className="font-semibold text-fg">Đăng nhập</span>
        </Link>
        <p className="text-center text-[11px] leading-relaxed text-fg-subtle">
          Xu chỉ dùng trong RaceHub, không quy đổi thành tiền. Đăng ký nghĩa là bạn đồng ý{' '}
          <Link href={routes.terms} className="underline">Điều khoản</Link> và <Link href={routes.privacy} className="underline">Quyền riêng tư</Link>.
        </p>
      </div>
    </main>
  )
}

function Doll({ body, label }: { body: 'male_run' | 'female_run'; label: string }) {
  return (
    <div className="h-full max-h-[min(46dvh,380px)] aspect-[2/3] overflow-hidden rounded-3xl border border-border shadow-[0_0_60px_-10px] shadow-brand/30">
      <PaperDoll gender={body} items={[]} className="size-full" label={label} />
    </div>
  )
}

function Chip({ children, big, className }: { children: ReactNode; big?: boolean; className?: string }) {
  return <p className={cn('rounded-2xl border border-border bg-surface px-4 py-3 font-extrabold', big && 'text-2xl', className)}>{children}</p>
}
function Arrow() {
  return <p className="text-fg-subtle" aria-hidden>↓</p>
}
