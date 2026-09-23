'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Camera, ImageUp, LogOut, Mail, PersonStanding, Ruler, Trash2, UserRound, Weight } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/shared/lib/supabase'
import { Button, Card, ErrorState, Field, Input, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { useInvalidateProfile, useSession } from '@/features/auth'
import { renderPortrait, resolveOutfit, useCharacterState } from '@/features/character'
import { getMyProfile, profileErrorMessage, setAvatarUrl, updateMyProfile, uploadAvatar } from '../api/profileApi'
import {
  ageInfo, centerSquare, diffDraft, maxBirthDate, toDraft, validateDraft,
  type Gender, type MyProfile, type ProfileDraft,
} from '../model/profileForm'
import PrivacySettings from './PrivacySettings'

const myProfileKey = ['my-profile'] as const
const GENDERS: { value: Gender; label: string }[] = [{ value: 'male', label: 'Nam' }, { value: 'female', label: 'Nữ' }]

/** Màn Cài đặt (/me/settings): hồ sơ cá nhân, ảnh đại diện, quyền riêng tư, tài khoản */
export function SettingsScreen() {
  const q = useQuery({ queryKey: myProfileKey, queryFn: getMyProfile })
  return (
    <div className="space-y-4 pb-6 animate-fade-in">
      <div className="flex items-center gap-2">
        <Link href={routes.me} aria-label="Quay lại" className="-ml-2 grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2">
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <h1 className="text-xl font-bold">Cài đặt</h1>
      </div>

      <SectionTitle>Hồ sơ</SectionTitle>
      {q.isPending ? <Skeleton className="h-[34rem]" />
        : q.isError ? <ErrorState message={profileErrorMessage(q.error)} onRetry={() => void q.refetch()} />
        : <ProfileCard key={JSON.stringify(q.data)} profile={q.data} />}

      <SectionTitle>Quyền riêng tư</SectionTitle>
      {q.data && <PrivacySettings userId={q.data.id} />}

      <SectionTitle>Tài khoản</SectionTitle>
      <AccountCard />
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="px-1 pt-2 text-xs font-bold uppercase tracking-wider text-fg-subtle">{children}</h2>
}

function useRefreshProfile() {
  const qc = useQueryClient()
  const invalidate = useInvalidateProfile()
  return () => {
    void qc.invalidateQueries({ queryKey: myProfileKey })
    void qc.invalidateQueries({ queryKey: ['character'] })
    void qc.invalidateQueries({ queryKey: ['athlete'] })
    invalidate()
  }
}

function ProfileCard({ profile }: { profile: MyProfile }) {
  const [draft, setDraft] = useState<ProfileDraft>(() => toDraft(profile))
  const refresh = useRefreshProfile()
  const errors = validateDraft(draft)
  const patch = diffDraft(profile, draft)
  const dirty = Object.keys(patch).length > 0
  const age = ageInfo(draft.birth_date)
  const set = <K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  const save = useMutation({
    mutationFn: () => updateMyProfile(patch),
    onSuccess: () => {
      refresh()
      toast.success(patch.gender ? 'Đã lưu hồ sơ. Nhân vật đã đổi theo giới tính mới.' : 'Đã lưu hồ sơ')
    },
    onError: (e) => toast.error(profileErrorMessage(e)),
  })

  return (
    <Card className="space-y-5">
      <AvatarEditor profile={profile} name={draft.display_name} />

      <Field label="Tên hiển thị" htmlFor="pf-name" error={errors.display_name}>
        <Input id="pf-name" value={draft.display_name} maxLength={40} autoComplete="nickname"
          onChange={(e) => set('display_name', e.target.value)} />
      </Field>

      <Field label="Giới thiệu" htmlFor="pf-bio" error={errors.bio}
        hint={<span className="flex justify-between"><span>Hiện trên hồ sơ công khai</span><span className="font-mono">{draft.bio.trim().length}/160</span></span>}>
        <Textarea id="pf-bio" value={draft.bio} maxLength={160} rows={2} placeholder="Ví dụ: Chạy sáng Hồ Tây, mục tiêu sub-4 marathon"
          onChange={(e) => set('bio', e.target.value)} className="min-h-20" />
      </Field>

      <Field label="Giới tính" hint="Nhân vật của bạn sẽ đổi theo. Dùng để xếp hạng theo giới trong thử thách.">
        <div role="radiogroup" aria-label="Giới tính" className="grid grid-cols-2 gap-2">
          {GENDERS.map((g) => (
            <button key={g.value} type="button" role="radio" aria-checked={draft.gender === g.value} onClick={() => set('gender', g.value)}
              className={cn('flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-colors',
                draft.gender === g.value ? 'border-brand bg-brand/10 text-fg' : 'border-border text-fg-muted hover:text-fg')}>
              <PersonStanding className="size-4" aria-hidden />{g.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Ngày sinh" htmlFor="pf-birth" error={errors.birth_date}
        hint={age ? `${age.age} tuổi · nhóm tuổi thi đấu ${age.group}` : 'Chỉ bạn xem được. Dùng để xếp nhóm tuổi thi đấu.'}>
        <Input id="pf-birth" type="date" value={draft.birth_date} min="1920-01-01" max={maxBirthDate()}
          onChange={(e) => set('birth_date', e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Chiều cao" htmlFor="pf-height" error={errors.height_cm}>
          <Unit icon={Ruler} unit="cm">
            <Input id="pf-height" inputMode="numeric" value={draft.height_cm} placeholder="170" className="pl-9 pr-11"
              onChange={(e) => set('height_cm', e.target.value.replace(/[^\d]/g, '').slice(0, 3))} />
          </Unit>
        </Field>
        <Field label="Cân nặng" htmlFor="pf-weight" error={errors.weight_kg}>
          <Unit icon={Weight} unit="kg">
            <Input id="pf-weight" inputMode="decimal" value={draft.weight_kg} placeholder="62,5" className="pl-9 pr-11"
              onChange={(e) => set('weight_kg', e.target.value.replace(/[^\d.,]/g, '').slice(0, 5))} />
          </Unit>
        </Field>
      </div>
      <p className="-mt-3 text-xs text-fg-subtle">Chiều cao, cân nặng và ngày sinh chỉ mình bạn xem được; dùng để ước tính calo và nhịp tim mục tiêu.</p>

      <div className="flex gap-2">
        <Button variant="secondary" className="shrink-0" disabled={!dirty || save.isPending} onClick={() => setDraft(toDraft(profile))}>Hoàn tác</Button>
        <Button block onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || Object.keys(errors).length > 0}>
          {dirty ? 'Lưu hồ sơ' : 'Đã lưu'}
        </Button>
      </div>
    </Card>
  )
}

function Unit({ icon: Icon, unit, children }: { icon: typeof Ruler; unit: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
      {children}
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-fg-subtle">{unit}</span>
    </div>
  )
}

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

function AvatarEditor({ profile, name }: { profile: MyProfile; name: string }) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<{ blob: Blob; url: string; source: 'photo' | 'character' } | null>(null)
  const [making, setMaking] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const character = useCharacterState()
  const refresh = useRefreshProfile()
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url) }, [preview])

  const upload = useMutation({
    mutationFn: (blob: Blob) => uploadAvatar(profile.id, blob),
    onSuccess: () => { refresh(); toast.success('Đã đổi ảnh đại diện'); close() },
    onError: (e) => toast.error(profileErrorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: () => setAvatarUrl(profile.id, null),
    onSuccess: () => { refresh(); toast.success('Đã gỡ ảnh đại diện'); close() },
    onError: (e) => toast.error(profileErrorMessage(e)),
  })
  const close = () => { setOpen(false); setPreview(null) }

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error('Hãy chọn một file ảnh.'); return }
    try {
      const blob = await squareJpeg(file)
      setPreview({ blob, url: URL.createObjectURL(blob), source: 'photo' })
    } catch {
      toast.error('Không đọc được ảnh này. Thử ảnh JPG hoặc PNG khác.')
    }
  }
  const fromCharacter = async () => {
    if (!character.data) return
    setMaking(true)
    try {
      const s = character.data
      const blob = await renderPortrait(s.gender, resolveOutfit(s.items, s.equipped))
      setPreview({ blob, url: URL.createObjectURL(blob), source: 'character' })
    } catch {
      toast.error('Không tạo được ảnh từ nhân vật. Thử lại sau.')
    } finally {
      setMaking(false)
    }
  }

  const initial = (name || profile.display_name || 'R').trim().charAt(0).toUpperCase()
  return (
    <div className="flex items-center gap-4">
      <button type="button" onClick={() => setOpen(true)} aria-label="Đổi ảnh đại diện" className="relative shrink-0">
        <span className="grid size-20 place-items-center overflow-hidden rounded-full bg-brand text-3xl font-black text-brand-fg ring-4 ring-bg">
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh đại diện trên Supabase Storage */}
          {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="size-full object-cover" /> : initial}
        </span>
        <span className="absolute -bottom-0.5 -right-0.5 grid size-8 place-items-center rounded-full border-2 border-surface bg-surface-2 text-fg">
          <Camera className="size-4" aria-hidden />
        </span>
      </button>
      <div className="min-w-0">
        <p className="font-semibold">Ảnh đại diện</p>
        <p className="text-xs text-fg-muted">Hiện ở bảng tin, bảng xếp hạng và CLB</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => setOpen(true)}>Đổi ảnh</Button>
      </div>

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
            <Option icon={ImageUp} title="Chọn ảnh từ máy" desc="JPG, PNG, WEBP · tự cắt vuông ở giữa" onClick={() => fileRef.current?.click()} />
            <Option icon={UserRound} title="Dùng nhân vật của tôi" desc="Chân dung nhân vật đang mặc bộ đồ hiện tại"
              onClick={() => void fromCharacter()} loading={making || character.isPending} />
            {profile.avatar_url && (
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

function AccountCard() {
  const { session } = useSession()
  const [confirm, setConfirm] = useState(false)
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-fg-muted"><Mail className="size-5" aria-hidden /></span>
        <div className="min-w-0">
          <p className="text-xs text-fg-muted">Email đăng nhập</p>
          <p className="truncate font-semibold">{session?.user.email ?? '—'}</p>
        </div>
      </div>
      {confirm ? (
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={() => setConfirm(false)}>Hủy</Button>
          <Button variant="danger" block onClick={() => void supabase.auth.signOut()}><LogOut className="size-4" aria-hidden />Đăng xuất</Button>
        </div>
      ) : (
        <Button variant="secondary" block onClick={() => setConfirm(true)}><LogOut className="size-4" aria-hidden />Đăng xuất</Button>
      )}
    </Card>
  )
}
