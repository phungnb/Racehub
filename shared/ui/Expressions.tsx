'use client'

import { useState } from 'react'
import { Smile } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { EMOJI_GROUPS, isEmojiOnly, QUICK_CHEERS, STICKERS, stickerBody, stickerImage, stickerOf, type Sticker } from '@/shared/lib/expressions'

/** Sticker động: ảnh động nếu tải được, không thì emoji to có hiệu ứng nhún nhảy */
export function StickerArt({ s, size = 96 }: { s: Sticker; size?: number }) {
  const [broken, setBroken] = useState(false)
  return broken ? (
    <span aria-hidden className="inline-grid animate-sticker place-items-center leading-none" style={{ width: size, height: size, fontSize: size * 0.72 }}>{s.emoji}</span>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- ảnh động webp từ bộ emoji mở, không qua tối ưu ảnh của Next
    <img src={stickerImage(s)} alt="" width={size} height={size} loading="lazy" decoding="async" draggable={false}
      onError={() => setBroken(true)} className="select-none" style={{ width: size, height: size }} />
  )
}

/**
 * Nội dung là sticker hoặc chỉ có emoji → vẽ to, không có khung bong bóng. Trả về null nếu là chữ thường
 * (nơi gọi tự hiện bong bóng như cũ).
 */
export function ExpressiveBody({ body, align = 'start' }: { body: string; align?: 'start' | 'end' }) {
  const s = stickerOf(body)
  if (s) {
    return (
      <span role="img" aria-label={`Sticker: ${s.caption}`} className={cn('flex flex-col gap-0.5', align === 'end' ? 'items-end' : 'items-start')}>
        <StickerArt s={s} />
        <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-bold text-fg">{s.caption}</span>
      </span>
    )
  }
  if (isEmojiOnly(body)) return <span className="block text-5xl leading-tight">{body.trim()}</span>
  return null
}

/** Hàng câu cổ vũ nhanh: chạm là gửi ngay */
export function QuickCheers({ onPick, disabled, className }: { onPick: (text: string) => void; disabled?: boolean; className?: string }) {
  return (
    <div role="group" aria-label="Cổ vũ nhanh" className={cn('-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]', className)}>
      {QUICK_CHEERS.map((t) => (
        <button key={t} type="button" disabled={disabled} onClick={() => onPick(t)}
          className="shrink-0 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:border-brand/60 hover:bg-brand/10 disabled:opacity-50">
          {t}
        </button>
      ))}
    </div>
  )
}

type Tab = 'CHEER' | 'EMOJI' | 'STICKER'

/** Bảng biểu cảm: cổ vũ nhanh · emoji · sticker động */
export function ExpressionPanel({ onEmoji, onSend, showCheers = true, className }: {
  onEmoji: (e: string) => void; onSend: (body: string) => void; showCheers?: boolean; className?: string
}) {
  const [tab, setTab] = useState<Tab>('STICKER')
  const tabs: [Tab, string][] = [...(showCheers ? [['CHEER', 'Cổ vũ nhanh'] as [Tab, string]] : []), ['STICKER', 'Sticker'], ['EMOJI', 'Emoji']]
  return (
    <div className={cn('rounded-2xl border border-border bg-surface p-2 shadow-lg', className)}>
      <div role="tablist" aria-label="Biểu cảm" className="mb-2 flex gap-1">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn('rounded-full px-3 py-1 text-xs font-semibold', tab === k ? 'bg-brand/15 text-brand' : 'text-fg-muted hover:bg-surface-2')}>{label}</button>
        ))}
      </div>
      <div className="max-h-56 overflow-y-auto overscroll-contain">
        {tab === 'CHEER' && (
          <div className="flex flex-wrap gap-1.5">
            {QUICK_CHEERS.map((t) => (
              <button key={t} type="button" onClick={() => onSend(t)} className="rounded-full border border-border px-3 py-1.5 text-sm hover:bg-surface-2">{t}</button>
            ))}
          </div>
        )}
        {tab === 'STICKER' && (
          <div className="grid grid-cols-4 gap-1">
            {STICKERS.map((s) => (
              <button key={s.id} type="button" onClick={() => onSend(stickerBody(s))} aria-label={`Gửi sticker ${s.caption}`}
                className="flex flex-col items-center gap-0.5 rounded-xl p-1 hover:bg-surface-2 active:scale-95">
                <StickerArt s={s} size={52} />
                <span className="w-full truncate text-center text-[11px] text-fg-muted">{s.caption}</span>
              </button>
            ))}
          </div>
        )}
        {tab === 'EMOJI' && EMOJI_GROUPS.map((g) => (
          <div key={g.label} className="mb-1.5">
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{g.label}</p>
            <div className="grid grid-cols-9 gap-0.5">
              {g.items.map((e) => (
                <button key={e} type="button" onClick={() => onEmoji(e)} aria-label={`Chèn ${e}`}
                  className="grid aspect-square place-items-center rounded-lg text-2xl hover:bg-surface-2 active:scale-90">{e}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Nút mở bảng biểu cảm (mặt cười) */
export function ExpressionToggle({ open, onToggle, className }: { open: boolean; onToggle: () => void; className?: string }) {
  return (
    <button type="button" onClick={onToggle} aria-label={open ? 'Đóng bảng biểu cảm' : 'Emoji và sticker'} aria-expanded={open}
      className={cn('grid size-11 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-surface-2', open && 'bg-brand/15 text-brand', className)}>
      <Smile className="size-6" aria-hidden />
    </button>
  )
}
