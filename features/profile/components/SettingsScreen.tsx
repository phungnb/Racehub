'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, LogOut, Mail, PersonStanding, Ruler, Trash2, Weight } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/shared/lib/supabase'
import { Button, Card, ConfirmSheet, ErrorState, Field, Input, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { useSession } from '@/features/auth'
import { PushSettingsCard, unsubscribeThisDevice } from '@/features/notification'
import { getMyProfile, profileErrorMessage, updateMyProfile } from '../api/profileApi'
import {
  ageInfo, diffDraft, maxBirthDate, toDraft, validateDraft,
  type Gender, type MyProfile, type ProfileDraft,
} from '../model/profileForm'
import PrivacySettings from './PrivacySettings'
import { StravaShareCard } from '@/features/integrations'
import { AvatarPicker } from './AvatarPicker'
import { myProfileKey, useRefreshProfile } from '../hooks/useRefreshProfile'

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
        : q.isError ? <ErrorState message={profileErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : <ProfileCard key={JSON.stringify(q.data)} profile={q.data} />}

      <SectionTitle>Thông báo & ứng dụng</SectionTitle>
      <PushSettingsCard />

      <SectionTitle>Quyền riêng tư</SectionTitle>
      {q.data && <PrivacySettings userId={q.data.id} />}
      <StravaShareCard />

      <SectionTitle>Tài khoản</SectionTitle>
      <AccountCard />
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="px-1 pt-2 text-xs font-bold uppercase tracking-wider text-fg-subtle">{children}</h2>
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
      <AvatarPicker userId={profile.id} avatarUrl={profile.avatar_url} name={draft.display_name || profile.display_name}>
        {(open) => (
          <div className="min-w-0">
            <p className="font-semibold">Ảnh đại diện</p>
            <p className="text-xs text-fg-muted">Hiện ở bảng tin, bảng xếp hạng và CLB</p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={open}>Đổi ảnh</Button>
          </div>
        )}
      </AvatarPicker>

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

function AccountCard() {
  const { session } = useSession()
  const [confirm, setConfirm] = useState(false)
  const [leaving, setLeaving] = useState(false)
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
          <Button variant="danger" block loading={leaving} onClick={() => { setLeaving(true); void unsubscribeThisDevice().finally(() => supabase.auth.signOut()) }}><LogOut className="size-4" aria-hidden />Đăng xuất</Button>
        </div>
      ) : (
        <Button variant="secondary" block onClick={() => setConfirm(true)}><LogOut className="size-4" aria-hidden />Đăng xuất</Button>
      )}
      <DeleteAccount />
      <p className="flex justify-center gap-4 pt-1 text-xs text-fg-muted">
        <a href="/privacy" className="underline hover:text-fg">Chính sách quyền riêng tư</a>
        <a href="/terms" className="underline hover:text-fg">Điều khoản sử dụng</a>
      </p>
    </Card>
  )
}

const DELETE_ERRORS: Record<string, string> = {
  CONFIRM_REQUIRED: 'Gõ đúng chữ XOÁ để xác nhận.',
  ADMIN_CANNOT_DELETE: 'Tài khoản quản trị viên cần được gỡ quyền quản trị trước khi xoá.',
  TRANSFER_CLUB_FIRST: 'Bạn đang là chủ nhiệm CLB còn thành viên — hãy chuyển quyền chủ nhiệm cho người khác trước.',
}

/** Xoá tài khoản (bắt buộc theo App Store / Google Play và Luật Bảo vệ dữ liệu cá nhân) */
function DeleteAccount() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const del = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/account/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: text }) })
      const j = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(j.error ?? 'SERVER_ERROR')
    },
    onSuccess: async () => {
      await unsubscribeThisDevice().catch(() => undefined)
      try { localStorage.clear() } catch { /* bỏ qua */ }
      await supabase.auth.signOut().catch(() => undefined)
      toast.success('Đã xoá tài khoản. Cảm ơn bạn đã chạy cùng RaceHub.')
      router.replace('/')
    },
    onError: (e) => toast.error(DELETE_ERRORS[(e as Error).message] ?? 'Không xoá được tài khoản. Thử lại sau ít phút.'),
  })
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center justify-center gap-1.5 pt-1 text-xs font-semibold text-danger hover:underline">
        <Trash2 className="size-3.5" aria-hidden />Xoá tài khoản
      </button>
      <ConfirmSheet open={open} onClose={() => { setOpen(false); setText('') }} title="Xoá tài khoản RaceHub?" confirmLabel="Xoá vĩnh viễn"
        loading={del.isPending} onConfirm={() => del.mutate()}>
        <div className="space-y-3 text-sm text-fg-muted">
          <ul className="list-disc space-y-1 pl-5">
            <li>Xoá hồ sơ, ảnh, tuyến GPS, cài đặt, kết nối Strava; bạn rời mọi CLB.</li>
            <li>Bài chạy bị ẩn; tên bạn trong tin nhắn / bảng xếp hạng cũ hiện “Người dùng đã xoá”.</li>
            <li>Xu, vật phẩm, gói VIP <b className="text-fg">mất vĩnh viễn, không hoàn tiền</b>. Hoá đơn giao dịch được giữ ẩn danh theo quy định kế toán.</li>
            <li>Không khôi phục được. Bạn vẫn có thể đăng ký lại bằng email này như người mới.</li>
          </ul>
          <Field label="Gõ XOÁ để xác nhận">
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="XOÁ" autoComplete="off" />
          </Field>
        </div>
      </ConfirmSheet>
    </>
  )
}
