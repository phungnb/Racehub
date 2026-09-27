'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, LogOut, Menu, Trash2, X } from 'lucide-react'
import { supabase } from '@/shared/lib/supabase'
import { cn } from '@/shared/lib/cn'
import { CoinAmount } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import { ICONS } from '@/shared/config/brand'
import type { Profile } from '@/shared/types/profile'
import { helpMenu } from '../api/helpApi'
import { companyLine, featuredMenu, groupMenu, SECTION_LABEL, STATIC_POLICIES, staticHref } from '../model/help'

/**
 * Nút ☰ + menu trượt từ trái: Hướng dẫn chơi · Chính sách & quy định · Hỗ trợ · tài khoản.
 * Dùng cả khi chưa đăng nhập (màn giới thiệu) — người dùng phải đọc được chính sách trước khi đồng ý đăng ký.
 */
export function MenuDrawer({ profile, onSignOut, className }: {
  profile?: Profile | null
  /** Việc cần làm trước khi đăng xuất (vd. huỷ đăng ký push của máy này) */
  onSignOut?: () => Promise<unknown>
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Mở menu hướng dẫn và chính sách" aria-haspopup="dialog"
        className={cn('grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg', className)}>
        <Menu className="size-6" aria-hidden />
      </button>
      {open && <Drawer profile={profile ?? null} onSignOut={onSignOut} onClose={() => setOpen(false)} />}
    </>
  )
}

function Drawer({ profile, onSignOut, onClose }: { profile: Profile | null; onSignOut?: () => Promise<unknown>; onClose: () => void }) {
  const router = useRouter()
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const [leaving, setLeaving] = useState(false)
  const menu = useQuery({ queryKey: ['help', 'menu'], queryFn: helpMenu, staleTime: 10 * 60_000 })
  // Chưa chạy migration 007300 / mất mạng: vẫn luôn có Điều khoản + Quyền riêng tư
  const groups = menu.data ? groupMenu(menu.data.pages) : [{ section: 'POLICY' as const, items: STATIC_POLICIES }]
  const company = companyLine(menu.data?.site ?? {})
  const featured = featuredMenu(menu.data?.pages ?? [])

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.querySelector<HTMLElement>('button[data-close]')?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      prev?.focus?.()
    }
  }, [onClose])

  const signOut = async () => {
    setLeaving(true)
    await onSignOut?.().catch(() => undefined)
    await supabase.auth.signOut().catch(() => undefined)
    onClose()
    router.replace(routes.login)
  }

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <button aria-label="Đóng menu" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-[2px] animate-fade-in" />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="absolute inset-y-0 left-0 flex w-[86vw] max-w-sm flex-col border-r border-border bg-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl animate-drawer-in">
        {/* Đầu menu: tài khoản hoặc nút đăng ký */}
        <div className="border-b border-border bg-surface px-4 pb-4 pt-3">
          <div className="flex items-center justify-between">
            <p id={titleId} className="flex items-center gap-2 text-base font-extrabold tracking-wide">
              {/* eslint-disable-next-line @next/next/no-img-element -- biểu tượng tĩnh nhỏ */}
              <img src={ICONS.mark} alt="" width={24} height={24} className="size-6" />
              <span>RACE<span className="text-brand">HUB</span></span>
            </p>
            <button data-close type="button" onClick={onClose} aria-label="Đóng menu"
              className="-mr-2 grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          {profile ? (
            <Link href={routes.me} onClick={onClose} className="mt-2 flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
              <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-brand/15 text-sm font-bold text-brand">
                {/* eslint-disable-next-line @next/next/no-img-element -- ảnh đại diện người dùng */}
                {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="size-full object-cover" /> : initials(profile.display_name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{profile.display_name ?? 'Runner'}</span>
                <span className="flex items-center gap-2 text-xs text-fg-muted">Level {profile.level ?? 1} · <CoinAmount value={profile.xu} className="text-xs" /></span>
              </span>
              <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
            </Link>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-sm text-fg-muted">Biến mỗi km thành một cuộc chơi.</p>
              <div className="grid grid-cols-2 gap-2">
                <Link href={`${routes.login}?mode=register`} onClick={onClose}
                  className="flex min-h-11 items-center justify-center rounded-xl bg-brand text-sm font-bold text-brand-fg">Đăng ký</Link>
                <Link href={routes.login} onClick={onClose}
                  className="flex min-h-11 items-center justify-center rounded-xl border border-border text-sm font-semibold">Đăng nhập</Link>
              </div>
            </div>
          )}
        </div>

        <nav aria-label="Hướng dẫn và chính sách" className="flex-1 overflow-y-auto px-2 py-3">
          {/* Nổi bật: gói trả phí và doanh nghiệp — tiêu đề / mô tả admin sửa được (trang menu vip-pro, doanh-nghiep) */}
          <ul className="mb-4 grid gap-2 px-1">
            {featured.map((f, i) => (
              <li key={f.slug}>
                <Link href={staticHref(f.slug)} onClick={onClose}
                  className={cn('flex items-center gap-3 rounded-2xl border p-3',
                    i === 0 ? 'border-coin/40 bg-gradient-to-br from-coin/15 to-surface' : 'border-brand/40 bg-gradient-to-br from-brand/15 to-surface')}>
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-bg/60 text-xl" aria-hidden>{f.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{f.title}</span>
                    {f.summary && <span className="block text-xs text-fg-muted">{f.summary}</span>}
                  </span>
                  <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          {groups.map((g) => (
            <section key={g.section} className="mb-3">
              <h2 className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">{SECTION_LABEL[g.section]}</h2>
              <ul>
                {g.items.map((p) => (
                  <li key={p.slug}>
                    <Link href={staticHref(p.slug)} onClick={onClose}
                      className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 hover:bg-surface-2">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-base" aria-hidden>{p.icon ?? '📄'}</span>
                      <span className="min-w-0 flex-1 text-sm font-medium">{p.title}</span>
                      <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {menu.isPending && <p className="px-3 text-xs text-fg-subtle">Đang tải hướng dẫn…</p>}

          {profile && (
            <section className="mb-3">
              <h2 className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">Tổ chức</h2>
              <ul>
                <li><Link href={routes.orgs} onClick={onClose} className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 hover:bg-surface-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-base" aria-hidden>🏢</span>
                  <span className="min-w-0 flex-1 text-sm font-medium">Tổ chức của tôi (nhập mã mời)</span><ChevronRight className="size-4 text-fg-subtle" aria-hidden />
                </Link></li>
              </ul>
            </section>
          )}

          {profile && (
            <section className="mt-2 border-t border-border pt-3">
              <button type="button" onClick={() => void signOut()} disabled={leaving}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-60">
                <LogOut className="size-5" aria-hidden />{leaving ? 'Đang đăng xuất…' : 'Đăng xuất'}
              </button>
              <Link href={`${routes.settings}?xoa=1`} onClick={onClose}
                className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-danger hover:bg-danger/10">
                <Trash2 className="size-5" aria-hidden />Xoá tài khoản
              </Link>
            </section>
          )}
        </nav>

        <footer className="border-t border-border px-5 py-3 text-[11px] leading-relaxed text-fg-subtle">
          <p>RaceHub · Run. Connect. Evolve.</p>
          {company.map((l) => <p key={l}>{l}</p>)}
        </footer>
      </div>
    </div>,
    document.body,
  )
}

const initials = (name: string | null | undefined) =>
  (name ?? 'R').trim().split(/\s+/).slice(-2).map((w) => w[0]?.toUpperCase() ?? '').join('') || 'R'
