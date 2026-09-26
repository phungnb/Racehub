'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ImagePlus, Lock, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Input } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { clubErrorMessage, setClubBranding, uploadClubCover, type Club, type ClubTheme } from '../../api/clubApi'
import { clubKeys } from '../../hooks/keys'
import { CLUB_THEMES } from '../../model/theme'
import { ClubAvatar } from '../hub/ClubAvatar'

/** Tường nhà CLB Pro: ảnh bìa, vị trí ảnh, khẩu hiệu, chủ đề màu — xem trước trực tiếp */
export function BrandingEditor({ club, active }: { club: Club; active: boolean }) {
  const qc = useQueryClient()
  const file = useRef<HTMLInputElement>(null)
  const [cover, setCover] = useState<string | null>(club.cover_url ?? null)
  const [pos, setPos] = useState(club.cover_position ?? 50)
  const [tagline, setTagline] = useState(club.tagline ?? '')
  const [theme, setTheme] = useState<ClubTheme | null>(club.theme ?? null)

  const upload = useMutation({
    mutationFn: (f: File) => uploadClubCover(club.id, f),
    onSuccess: (url) => { setCover(url); setPos(50) },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const save = useMutation({
    mutationFn: () => setClubBranding(club.id, { cover_url: cover, cover_position: pos, tagline: tagline.trim() || null, theme }),
    onSuccess: () => {
      toast.success('Đã cập nhật tường nhà CLB')
      void qc.invalidateQueries({ queryKey: clubKeys.club(club.id) })
    },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const dirty = cover !== (club.cover_url ?? null) || pos !== (club.cover_position ?? 50)
    || (tagline.trim() || null) !== (club.tagline ?? null) || theme !== (club.theme ?? null)
  const bg = theme ? CLUB_THEMES[theme].bg : 'linear-gradient(135deg, #1f2937, #0b1020)'

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">Tường nhà CLB</p>
      {/* Xem trước */}
      <div className="relative overflow-hidden rounded-2xl" style={{ background: bg }}>
        {cover && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover} alt="" className="absolute inset-0 size-full object-cover" style={{ objectPosition: `50% ${pos}%` }} />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
          </>
        )}
        <div className={cn('relative flex items-end gap-3 p-4', cover ? 'pt-24' : 'pt-10')}>
          <ClubAvatar club={club} size="md" className="ring-2 ring-coin" />
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-bold text-white drop-shadow">
              <span className="truncate">{club.name}</span>
              <span className="shrink-0 rounded-full bg-gradient-to-r from-coin to-amber-300 px-2 py-0.5 text-[10px] font-black text-bg">✦ PRO</span>
            </p>
            {tagline.trim() && <p className="truncate text-xs italic text-white/90">“{tagline.trim()}”</p>}
          </div>
        </div>
        {!active && (
          <div className="absolute inset-0 grid place-items-center bg-black/55 text-center text-sm font-semibold text-white">
            <span className="flex items-center gap-2"><Lock className="size-4" aria-hidden />Nâng cấp CLB Pro để trang trí tường nhà</span>
          </div>
        )}
      </div>

      {active && (
        <>
          <div className="flex gap-2">
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload.mutate(f) }} />
            <Button variant="secondary" className="flex-1" loading={upload.isPending} onClick={() => file.current?.click()}>
              <ImagePlus className="size-4" aria-hidden />{cover ? 'Đổi ảnh bìa' : 'Tải ảnh bìa'}
            </Button>
            {cover && <Button variant="ghost" onClick={() => setCover(null)} aria-label="Bỏ ảnh bìa"><Trash2 className="size-4" aria-hidden /></Button>}
          </div>
          {cover && (
            <label className="block text-xs text-fg-muted">
              Vị trí ảnh (kéo để căn khung)
              <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="mt-1 w-full accent-brand" />
            </label>
          )}
          <div>
            <Input value={tagline} maxLength={80} onChange={(e) => setTagline(e.target.value)} placeholder="Khẩu hiệu, vd: Chạy cùng nhau, đi xa hơn" aria-label="Khẩu hiệu CLB" />
            <p className="mt-1 text-right text-[11px] text-fg-subtle">{tagline.length}/80</p>
          </div>
          <div>
            <p className="mb-1.5 text-xs text-fg-muted">Chủ đề màu</p>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(CLUB_THEMES) as ClubTheme[]).map((k) => (
                <button key={k} type="button" aria-pressed={theme === k} onClick={() => setTheme(theme === k ? null : k)}
                  className={cn('relative h-14 overflow-hidden rounded-xl border-2 text-left', theme === k ? 'border-coin' : 'border-transparent')}
                  style={{ background: CLUB_THEMES[k].bg }}>
                  <span className="absolute bottom-1 left-2 text-[11px] font-semibold text-white drop-shadow">{CLUB_THEMES[k].label}</span>
                  {theme === k && <Check className="absolute right-1.5 top-1.5 size-4 text-white" aria-hidden />}
                </button>
              ))}
            </div>
          </div>
          <Button block onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || upload.isPending}>Lưu tường nhà</Button>
        </>
      )}
    </div>
  )
}
