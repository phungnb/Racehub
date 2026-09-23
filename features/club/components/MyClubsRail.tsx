'use client'

import { ClubAvatar } from './ClubSettings'
import { ROLE_LABEL, isStaff, type Club, type ClubRole } from '../api'

/**
 * "CLB của tôi": thanh biểu tượng cuộn ngang + thẻ tóm tắt CLB đang chọn.
 * Đặt tại: features/club/components/MyClubsRail.tsx
 */

export interface MyClubItem {
  club: Club
  role: ClubRole
}

interface Props {
  items: MyClubItem[]
  activeId: string | null
  loading: boolean
  onSelect: (clubId: string) => void
  onOpen: (clubId: string) => void
  onFind: () => void
  onCreate: () => void
}

export default function MyClubsRail({ items, activeId, loading, onSelect, onOpen, onFind, onCreate }: Props) {
  const active = items.find((i) => i.club.id === activeId) ?? null

  /* ------------------------------ Đang tải ------------------------------ */
  if (loading) {
    return (
      <div className="flex gap-4 overflow-hidden px-1 py-2" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="w-16 shrink-0 space-y-2">
            <div className="w-[52px] h-[52px] rounded-xl bg-surface-2 animate-pulse mx-auto" />
            <div className="h-2 rounded bg-surface-2 animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  /* ------------------------ Chưa tham gia CLB nào ------------------------ */
  if (items.length === 0) {
    return (
      <div className="bg-surface border border-dashed border-fg-subtle rounded-2xl p-5 text-center space-y-3">
        <p className="text-fg font-bold text-sm">Bạn chưa tham gia CLB nào</p>
        <p className="text-fg-muted">
          Tham gia một CLB để chạy cùng nhau, góp quỹ và tham gia thử thách nội bộ.
        </p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={onFind}
            className="bg-brand hover:bg-brand-strong text-brand-fg font-black px-4 py-2 rounded-xl cursor-pointer"
          >
            Tìm CLB
          </button>
          <button
            onClick={onCreate}
            className="bg-surface-2 hover:bg-border text-fg font-bold px-4 py-2 rounded-xl cursor-pointer"
          >
            Thành lập CLB
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* -------------------- Thanh biểu tượng cuộn ngang -------------------- */}
      <div
        role="tablist"
        aria-label="CLB của tôi"
        className="flex gap-4 overflow-x-auto snap-x snap-mandatory px-1 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map(({ club, role }) => {
          const selected = club.id === activeId
          return (
            <button
              key={club.id}
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(club.id)}
              className="snap-start shrink-0 w-16 flex flex-col items-center gap-2 cursor-pointer group focus-visible:outline-none"
            >
              <span className="relative">
                <ClubAvatar
                  club={club}
                  size={52}
                  className={
                    selected
                      ? 'ring-2 ring-brand ring-offset-2 ring-offset-slate-950'
                      : 'opacity-70 group-hover:opacity-100 group-focus-visible:ring-2 group-focus-visible:ring-brand transition-opacity'
                  }
                />
                {isStaff(role) && (
                  <span
                    title={ROLE_LABEL[role]}
                    className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-brand text-brand-fg border-2 border-bg flex items-center justify-center text-xs"
                  >
                    {role === 'OWNER' ? '★' : '🛡'}
                  </span>
                )}
              </span>
              <span
                className={`w-full truncate text-center text-[11px] ${
                  selected ? 'text-white font-bold' : 'text-fg-muted'
                }`}
              >
                {club.name}
              </span>
            </button>
          )
        })}

        {/* Ô cuối: tìm thêm CLB */}
        <button
          onClick={onFind}
          className="snap-start shrink-0 w-16 flex flex-col items-center gap-2 cursor-pointer group"
        >
          <span className="w-[52px] h-[52px] rounded-xl border-2 border-dashed border-fg-subtle group-hover:border-brand text-fg-subtle group-hover:text-brand flex items-center justify-center text-xl transition-colors">
            +
          </span>
          <span className="text-[11px] text-fg-subtle">Tìm thêm</span>
        </button>
      </div>

      {/* ------------------- Thẻ tóm tắt CLB đang chọn ------------------- */}
      {active && (
        <div role="tabpanel" className="bg-surface border border-border rounded-2xl p-4 space-y-3 shadow-xl">
          <div className="flex items-center gap-3">
            <ClubAvatar club={active.club} size={48} />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-black text-white truncate">{active.club.name}</h3>
              <p className="text-xs text-fg-muted">Bạn là {ROLE_LABEL[active.role].toLowerCase()}</p>
            </div>
          </div>

          {active.club.announcement && (
            <p className="text-fg bg-bg border border-border rounded-xl p-2.5 line-clamp-2 whitespace-pre-line">
              {active.club.announcement}
            </p>
          )}

          <dl className="grid grid-cols-2 gap-2">
            <div className="bg-bg rounded-xl p-3">
              <dt className="text-xs text-fg-muted">Thành viên</dt>
              <dd className="text-base font-black text-white mt-0.5">
                {active.club.member_count}
                <span className="text-fg-subtle text-xs font-bold">/{active.club.member_limit}</span>
              </dd>
            </div>
            <div className="bg-bg rounded-xl p-3">
              <dt className="text-xs text-fg-muted">Quỹ CLB</dt>
              <dd className="text-base font-black text-amber-400 mt-0.5">
                {active.club.treasury_balance.toLocaleString('vi-VN')}
                <span className="text-xs font-bold"> Xu</span>
              </dd>
            </div>
          </dl>

          <button
            onClick={() => onOpen(active.club.id)}
            className="w-full bg-brand hover:bg-brand-strong text-brand-fg font-black py-2.5 rounded-xl cursor-pointer"
          >
            Vào CLB
          </button>
        </div>
      )}
    </div>
  )
}
