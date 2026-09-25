'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Camera, ImageUp, Trash2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { renderPortrait, resolveOutfit, useCharacterState } from '@/features/character'
import { profileErrorMessage, setAvatarUrl, uploadAvatar } from '../api/profileApi'
import { centerSquare } from '../model/profileForm'
import { useRefreshProfile } from '../hooks/useRefreshProfile'

/** Cắt vuông giữa ảnh, thu về 512px, JPEG — ảnh đại diện nhẹ (~40 KB) */
async function squareJpeg(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const { sx, sy, side } = centerSquare(bmp.width, bmp.height)
  const size = Math.min(512, side)
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  c.getContext('2d')!.drawImage(bmp, sx, sy, side, side, 0, 0, size, size)
  bmp.close()
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Không đọc được ảnh'))), 'image/jpeg', 0.88))
}

const SIZES = { md: 'size-16 text-2xl', lg: 'size-20 text-3xl' } as const

/**
 * Ảnh đại diện tròn có nút máy ảnh (kiểu Zalo): bấm vào là mở bảng chọn
 * ảnh từ máy / chân dung nhân vật / gỡ ảnh. `children` nhận hàm mở bảng để đặt thêm nút khác.
 */
export function AvatarPicker({ userId, avatarUrl, name, size = 'lg', shine = 0, children }: {
  userId: string; avatarUrl: string | null; name: string | null; size?: keyof typeof SIZES
  /** Bậc Tỏa sáng 0–4: khung phát sáng quanh ảnh */
  shine?: number
  children?: (open: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null)
  const [making, setMaking] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const character = useCharacterState()
  const refresh = useRefreshProfile()
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url) }, [preview])

  const close = () => { setOpen(false); setPreview(null) }
  const upload = useMutation({
    mutationFn: (blob: Blob) => uploadAvatar(userId, blob),
    onSuccess: () => { refresh(); toast.success('Đã đổi ảnh đại diện'); close() },
    onError: (e) => toast.error(profileErrorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: () => setAvatarUrl(userId, null),
    onSuccess: () => { refresh(); toast.success('Đã gỡ ảnh đại diện'); close() },
    onError: (e) => toast.error(profileErrorMessage(e)),
  })

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error('Hãy chọn một file ảnh.'); return }
    try {
      const blob = await squareJpeg(file)
      setPreview({ blob, url: URL.createObjectURL(blob) })
      setOpen(true)
    } catch {
      toast.error('Không đọc được ảnh này. Thử ảnh JPG hoặc PNG khác.')
    }
  }
  const fromCharacter = async () => {
    if (!character.data) return
    setMaking(true)
    try {
      const s = character.data
      const blob = await renderPortrait(s.gender, resolveOutfit(s.items, s.equipped), 512, s.display_name)
      setPreview({ blob, url: URL.createObjectURL(blob) })
    } catch {
      toast.error('Không tạo được ảnh từ nhân vật. Thử lại sau.')
    } finally {
      setMaking(false)
    }
  }

  const initial = (name || 'R').trim().charAt(0).toUpperCase()
  return (
    <div className="flex items-center gap-4">
      <button type="button" onClick={() => setOpen(true)} aria-label="Đổi ảnh đại diện" className="group relative shrink-0">
        <span className={cn(shine > 0 && `shine-frame shine-t${Math.min(4, shine)}`)}>
          <span className={cn('grid place-items-center overflow-hidden rounded-full bg-brand font-black text-brand-fg', shine > 0 ? 'shine-inner' : 'ring-4 ring-bg', SIZES[size])}>
            {/* eslint-disable-next-line @next/next/no-img-element -- ảnh đại diện trên Supabase Storage */}
            {avatarUrl ? <img src={avatarUrl} alt="" className="size-full object-cover" /> : initial}
          </span>
        </span>
        <span className="absolute -bottom-0.5 -right-0.5 grid size-7 place-items-center rounded-full border-2 border-surface bg-surface-2 text-fg shadow-sm group-hover:bg-surface">
          <Camera className="size-3.5" aria-hidden />
        </span>
      </button>
      {children?.(() => setOpen(true))}

      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
        onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = '' }} />

      <Sheet open={open} onClose={close} title="Ảnh đại diện"
        description={preview ? 'Xem trước ảnh mới' : 'Chọn ảnh chụp của bạn hoặc dùng chân dung nhân vật'}
        footer={preview ? (
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={() => setPreview(null)} disabled={upload.isPending}>Chọn lại</Button>
            <Button block onClick={() => upload.mutate(preview.blob)} loading={upload.isPending}>Dùng ảnh này</Button>
          </div>
        ) : undefined}>
        {preview ? (
          <div className="flex justify-center py-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- ảnh xem trước (blob) */}
            <img src={preview.url} alt="Ảnh đại diện mới" className="size-48 rounded-full object-cover ring-4 ring-brand/40" />
          </div>
        ) : (
          <div className="space-y-2">
            {avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- ảnh đại diện hiện tại
              <img src={avatarUrl} alt="Ảnh đại diện hiện tại" className="mx-auto mb-2 size-32 rounded-full object-cover" />
            )}
            <Option icon={ImageUp} title="Chọn ảnh từ máy" desc="Chụp mới hoặc chọn trong thư viện · tự cắt vuông" onClick={() => fileRef.current?.click()} />
            <Option icon={UserRound} title="Dùng nhân vật của tôi" desc="Chân dung nhân vật đang mặc bộ đồ hiện tại"
              onClick={() => void fromCharacter()} loading={making || character.isPending} />
            {avatarUrl && (
              <Option icon={Trash2} title="Gỡ ảnh hiện tại" desc="Dùng chữ cái đầu của tên" danger onClick={() => remove.mutate()} loading={remove.isPending} />
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}

function Option({ icon: Icon, title, desc, onClick, danger, loading }: {
  icon: typeof ImageUp; title: string; desc: string; onClick: () => void; danger?: boolean; loading?: boolean
}) {
  return (
    <button type="button" onClick={onClick} disabled={loading}
      className="flex w-full items-center gap-3 rounded-2xl border border-border p-3 text-left transition-colors hover:bg-surface-2 disabled:opacity-60">
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', danger ? 'bg-danger/15 text-danger' : 'bg-brand/15 text-brand')}>
        <Icon className={cn('size-5', loading && 'animate-pulse')} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className={cn('block font-semibold', danger && 'text-danger')}>{title}</span>
        <span className="block text-xs text-fg-muted">{loading ? 'Đang xử lý…' : desc}</span>
      </span>
    </button>
  )
}
