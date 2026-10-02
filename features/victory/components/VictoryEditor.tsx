'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Camera, Check, Download, Lock, Megaphone, RotateCcw, Search, Share2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ConfirmSheet, EmptyState, ErrorState, Input, PageHeader, Sheet, Skeleton, SwitchRow, useImageSaver, ScrollRow } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { matchesSearch } from '@/shared/lib/search'
import { DesignCanvas } from '@/shared/design/DesignCanvas'
import { FileButton } from '@/shared/design/studio/bits'
import { useMyProfile } from '@/features/auth'
import { bodyOf, renderCharacter, resolveOutfit, useCharacterState } from '@/features/character'
import { createPost, uploadPostImage, useClubInbox } from '@/features/club'
import { getFacts, getParticipants, issueVictory, recordExport, victoryErrorMessage } from '../api/victoryApi'
import {
  ACCENTS, defaultOptions, designPayload, drawVictory, fileName, KICKERS, MAX_STATS, MESSAGES, SUGGESTED, VIC_FORMATS, VIC_STYLES,
  VIC_TEMPLATES, type PhotoMode, type VicFacts, type VicFormat, type VicKind, type VicOptions, type VicStyle, type VicTemplate,
} from '../model/victory'
import { victoryKeys } from '../hooks/keys'
import { useVictoryAccess } from '../hooks/useVictoryAccess'
import { VictoryUpsell } from './VictoryUpsell'

const AWARDS = ['Runner bền bỉ nhất', 'Runner của tháng', 'Pacer tiêu biểu', 'Người truyền cảm hứng', 'Chiến binh km', 'Tân binh xuất sắc']

/**
 * Màn thiết kế ảnh vinh danh: xem trước ngay, đổi mẫu / khổ / ảnh / màu / lời chúc / thông số hiển thị.
 * Số liệu chỉ đọc (máy chủ điền). Khi xuất: máy chủ cấp mã xác thực, QR trên ảnh dẫn tới /v/<mã>.
 */
export function VictoryEditor({ kind, refId, user, pick }: { kind: VicKind; refId: string; user: string | null; pick: boolean }) {
  const [person, setPerson] = useState<string | null>(user)
  if (pick && !person) return <ParticipantPicker challengeId={refId} onPick={setPerson} />
  return <Editor kind={kind} refId={refId} user={person} onChangePerson={pick ? () => setPerson(null) : undefined} />
}

function Editor({ kind, refId, user, onChangePerson }: { kind: VicKind; refId: string; user: string | null; onChangePerson?: () => void }) {
  const q = useQuery({ queryKey: victoryKeys.facts(kind, refId, user), queryFn: () => getFacts(kind, refId, user), retry: false })
  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-10 w-2/3" /><Skeleton className="mx-auto aspect-[4/5] w-full max-w-sm" /></div>
  if (q.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title="Ảnh vinh danh" fallback={routes.victory} />
        <ErrorState message={victoryErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
      </div>
    )
  }
  return <Designer facts={q.data} user={user} onChangePerson={onChangePerson} />
}

function Designer({ facts: f, user, onChangePerson }: { facts: VicFacts; user: string | null; onChangePerson?: () => void }) {
  const { profile } = useMyProfile()
  const self = !user || user === profile?.id
  const [o, setO] = useState<VicOptions>(() => defaultOptions(f))
  const set = (patch: Partial<VicOptions>) => setO((x) => ({ ...x, ...patch }))
  const [style, setStyle] = useState<VicStyle | 'ALL'>('ALL')
  const [award, setAwardText] = useState('')
  const [upload, setUpload] = useState<string | null>(null)
  const [character, setCharacter] = useState<string | null>(null)
  const [origin] = useState(() => (typeof window === 'undefined' ? '' : window.location.origin))
  const [code, setCode] = useState<string | null>(null)
  const access = useVictoryAccess(f.kind === 'CHALLENGE' ? f.ref : null)
  // Đổi danh hiệu → mã cũ không còn khớp
  const setAward = (v: string) => { setAwardText(v); setCode(null) }
  const [post, setPost] = useState(false)
  const saver = useImageSaver()
  const char = useCharacterState()

  useEffect(() => () => { if (upload) URL.revokeObjectURL(upload) }, [upload])
  // Nhân vật 2D chỉ vẽ khi chọn (tốn vài trăm ms)
  useEffect(() => {
    if (o.photo !== 'character' || character || !self || !char.data) return
    const c = char.data
    let alive = true
    renderCharacter(bodyOf(c.gender, c.body), resolveOutfit(c.items, c.equipped), c.display_name)
      .then((cv) => { if (alive) setCharacter(cv.toDataURL('image/png')) })
      .catch(() => toast.error('Không vẽ được nhân vật. Thử ảnh đại diện nhé.'))
    return () => { alive = false }
  }, [o.photo, character, self, char.data])

  const assets = useMemo(() => ({
    photo: o.photo === 'upload' ? upload : o.photo === 'avatar' ? f.person.avatar_url : null,
    character: o.photo === 'character' ? character : null,
    verifyUrl: origin ? `${origin}/v/${code ?? 'RACEHUB0'}` : null,
    code, award: award.trim() || null,
  }), [o.photo, upload, f.person.avatar_url, character, origin, code, award])
  const size = VIC_FORMATS[o.format]
  const drawKey = JSON.stringify([o, assets])

  const templates = useMemo(() => {
    const all = Object.keys(VIC_TEMPLATES) as VicTemplate[]
    const sug = SUGGESTED[f.kind]
    const sorted = [...sug, ...all.filter((t) => !sug.includes(t))]
    return style === 'ALL' ? sorted : sorted.filter((t) => VIC_TEMPLATES[t].style === style)
  }, [f.kind, style])

  const toggleStat = (key: string) => set({
    stats: o.stats.includes(key) ? o.stats.filter((k) => k !== key) : o.stats.length >= MAX_STATS ? o.stats : [...o.stats, key],
  })

  // Xuất: máy chủ cấp mã (hoặc trả mã cũ) → vẽ bản cuối có QR đúng mã → ảnh
  const render = useMutation({
    mutationFn: async (type: 'image/png' | 'image/jpeg') => {
      const issued = await issueVictory(f.kind, f.ref, user && !self ? user : null, award.trim() || null, designPayload(o))
      setCode(issued.code)
      const canvas = document.createElement('canvas')
      await drawVictory(canvas, { ...issued.facts, person: issued.person, can_award: f.can_award }, o,
        { ...assets, code: issued.code, verifyUrl: `${window.location.origin}/v/${issued.code}` })
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.92))
      if (!blob) throw new Error('CANVAS')
      void recordExport(issued.code, designPayload(o)).catch(() => null)
      return { blob, code: issued.code, ext: type === 'image/png' ? 'png' as const : 'jpg' as const }
    },
    onError: (e) => toast.error((e as Error).message === 'CANVAS' ? 'Không tạo được ảnh (ảnh tải lên quá lớn?). Thử lại.' : victoryErrorMessage(e)),
  })
  const save = (type: 'image/png' | 'image/jpeg') => render.mutate(type, {
    onSuccess: ({ blob, code: c, ext }) => void saver.saveBlob(blob, fileName(f, c, ext), `${f.headline} · ${f.title}`),
  })
  const shareFile = () => render.mutate('image/png', {
    onSuccess: async ({ blob, code: c, ext }) => {
      const file = new File([blob], fileName(f, c, ext), { type: blob.type })
      if (!navigator.canShare?.({ files: [file] })) { void saver.saveBlob(blob, file.name, f.title); return }
      try { await navigator.share({ files: [file], title: f.title, text: `${f.headline} — ${f.title} 🏅 Xác thực: ${window.location.origin}/v/${c}` }) } catch (e) {
        if ((e as Error).name !== 'AbortError') toast.error('Không chia sẻ được. Hãy lưu ảnh rồi đăng.')
      }
    },
  })

  return (
    <div className="space-y-4 pb-40 animate-fade-in">
      <PageHeader title="Ảnh vinh danh" subtitle={`${f.headline} · ${f.title}`} fallback={routes.victory} />

      {!self && (
        <Card className="flex items-center gap-3 p-3">
          <Avatar src={f.person.avatar_url} name={f.person.display_name} size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-fg-muted">Vinh danh</p>
            <p className="truncate font-semibold">{f.person.display_name}</p>
          </div>
          {onChangePerson && <Button size="sm" variant="secondary" onClick={onChangePerson}>Đổi người</Button>}
        </Card>
      )}

      <div className="mx-auto w-full max-w-sm">
        <DesignCanvas size={size} drawKey={drawKey} label={`Xem trước ảnh vinh danh ${f.title}`}
          draw={(c) => drawVictory(c, f, o, assets)} />
        {code && (
          <p className="mt-2 text-center text-xs text-fg-muted">
            Mã xác thực <Link href={routes.victoryVerify(code)} className="font-mono font-bold text-brand">{code}</Link> · quét QR trên ảnh để kiểm tra
          </p>
        )}
      </div>

      {/* Mẫu */}
      <Section title="Mẫu">
        <ScrollRow className="-mx-1" innerClassName="gap-1.5 px-1 pb-1">
          {(['ALL', ...Object.keys(VIC_STYLES)] as (VicStyle | 'ALL')[]).map((s) => (
            <Chip key={s} on={style === s} onClick={() => setStyle(s)}>{s === 'ALL' ? 'Tất cả' : VIC_STYLES[s]}</Chip>
          ))}
        </ScrollRow>
        <ScrollRow className="-mx-1" innerClassName="gap-2 px-1 pb-1">
          {templates.map((t) => {
            const d = VIC_TEMPLATES[t]
            return (
              <button key={t} type="button" onClick={() => set({ template: t })} aria-pressed={o.template === t}
                className={cn('flex w-20 shrink-0 flex-col items-center gap-1 rounded-xl border p-1.5 text-[11px] font-semibold',
                  o.template === t ? 'border-brand bg-brand/10' : 'border-border')}>
                <span className="relative grid h-16 w-full place-items-center overflow-hidden rounded-lg" style={{ background: `linear-gradient(135deg, ${d.colors.bg} 55%, ${d.colors.band})` }}>
                  <span className="h-1.5 w-8 rounded-full" style={{ background: d.colors.accent }} />
                  {SUGGESTED[f.kind].includes(t) && <span className="absolute right-1 top-1 rounded bg-black/50 px-1 text-[9px] text-white">Gợi ý</span>}
                </span>
                {d.label}
              </button>
            )
          })}
        </ScrollRow>
      </Section>

      {/* Khổ ảnh */}
      <Section title="Khổ ảnh">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(VIC_FORMATS) as VicFormat[]).map((k) => (
            <Chip key={k} on={o.format === k} onClick={() => set({ format: k })} title={VIC_FORMATS[k].hint}>{VIC_FORMATS[k].label}</Chip>
          ))}
        </div>
      </Section>

      {/* Ảnh */}
      <Section title="Ảnh trên thiết kế">
        <div className="flex flex-wrap gap-1.5">
          {([['avatar', 'Ảnh đại diện'], ...(self ? [['character', 'Nhân vật RaceHub']] : []), ['upload', 'Ảnh của tôi'], ['none', 'Không ảnh']] as [PhotoMode, string][])
            .map(([k, label]) => <Chip key={k} on={o.photo === k} onClick={() => set({ photo: k })}>{label}</Chip>)}
        </div>
        {o.photo === 'upload' && (
          <FileButton label="Chọn ảnh" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-surface-2"
            onPick={(file) => {
              if (!file) return
              if (!file.type.startsWith('image/')) { toast.error('Hãy chọn ảnh.'); return }
              setUpload(URL.createObjectURL(file))
            }}>
            <Camera className="size-4" aria-hidden />{upload ? 'Đổi ảnh' : 'Chọn ảnh từ máy'}
          </FileButton>
        )}
        {o.photo === 'upload' && <p className="text-xs text-fg-subtle">Ảnh chỉ dùng để dựng thiết kế trên máy bạn, không tải lên RaceHub.</p>}
      </Section>

      {/* Thông số */}
      <Section title={`Thông số hiển thị (tối đa ${MAX_STATS})`}
        note={<span className="inline-flex items-center gap-1"><Lock className="size-3" aria-hidden />Số liệu lấy từ kết quả đã xác nhận trên RaceHub, không sửa được.</span>}>
        <div className="flex flex-wrap gap-1.5">
          {f.stats.map((s) => (
            <Chip key={s.key} on={o.stats.includes(s.key)} onClick={() => toggleStat(s.key)}>
              {o.stats.includes(s.key) && <Check className="size-3.5" aria-hidden />}{s.label}: <b className="font-bold">{s.value}</b>
            </Chip>
          ))}
        </div>
        {!!f.honors.length && (
          <SwitchRow checked={o.showHonor} onChange={(v) => set({ showHonor: v })} label={`Hiện hạng mục vinh danh: ${f.honors[0]}`} />
        )}
      </Section>

      {/* Danh hiệu (BTC) */}
      {f.can_award && (
        <Section title="Danh hiệu do BTC trao (tùy chọn)" note="Chỉ người tạo thử thách, ban quản trị CLB, admin đặt được. Người được vinh danh nhận thông báo.">
          <Input value={award} onChange={(e) => setAward(e.target.value)} maxLength={60} placeholder="VD: Runner bền bỉ nhất" aria-label="Danh hiệu" />
          <div className="flex flex-wrap gap-1.5">
            {AWARDS.map((a) => <Chip key={a} on={award === a} onClick={() => setAward(award === a ? '' : a)}>{a}</Chip>)}
          </div>
        </Section>
      )}

      {/* Chữ */}
      <Section title="Dòng chữ nhỏ phía trên">
        <div className="flex flex-wrap gap-1.5">
          {KICKERS.map((k) => <Chip key={k} on={o.kicker === k} onClick={() => set({ kicker: k })}>{k}</Chip>)}
        </div>
      </Section>
      <Section title="Lời chúc (tùy chọn)">
        <Input value={o.message} onChange={(e) => set({ message: e.target.value })} maxLength={90} placeholder="Viết lời chúc hoặc chọn gợi ý" aria-label="Lời chúc" />
        <div className="flex flex-wrap gap-1.5">
          {[...MESSAGES[f.kind], ...MESSAGES.ANY].map((m) => <Chip key={m} on={o.message === m} onClick={() => set({ message: o.message === m ? '' : m })}>{m}</Chip>)}
        </div>
      </Section>

      {/* Màu */}
      <Section title="Màu điểm nhấn">
        <div className="flex flex-wrap items-center gap-2">
          {ACCENTS.map((c) => (
            <button key={c} type="button" onClick={() => set({ accent: c })} aria-label={`Màu ${c}`} aria-pressed={o.accent === c}
              className={cn('size-9 rounded-full border-2', o.accent === c ? 'border-fg' : 'border-transparent')} style={{ background: c }} />
          ))}
          <button type="button" onClick={() => set({ accent: null })} className="inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-xs font-semibold text-fg-muted hover:bg-surface-2">
            <RotateCcw className="size-3.5" aria-hidden />Màu của mẫu
          </button>
        </div>
      </Section>

      <Card className="divide-y divide-border px-3 py-0">
        <SwitchRow checked={o.showQr} onChange={(v) => set({ showQr: v })} label="Mã QR" description="Người xem quét để mở thành tích này trên RaceHub (không cần đăng nhập, không cần nhập mã)" />
        {f.club && <SwitchRow checked={o.showClub} onChange={(v) => set({ showClub: v })} label={`Hiện tên CLB: ${f.club}`} />}
      </Card>

      {/* Thanh xuất ảnh */}
      {!access.unlocked && <VictoryUpsell compact />}
      {!access.unlocked ? (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md border-t border-border bg-bg/95 px-3 py-2 backdrop-blur-md">
          <Link href={routes.plans} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-coin text-sm font-bold text-black">
            <Lock className="size-4" aria-hidden />Nâng cấp để lưu và chia sẻ ảnh
          </Link>
        </div>
      ) : (
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md border-t border-border bg-bg/95 px-3 py-2 backdrop-blur-md">
        <div className="grid grid-cols-3 gap-2">
          <Button variant="secondary" onClick={() => save('image/png')} loading={render.isPending || saver.busy}><Download className="size-4" aria-hidden />Lưu PNG</Button>
          <Button variant="secondary" onClick={() => save('image/jpeg')} disabled={render.isPending}>Lưu JPG</Button>
          <Button onClick={shareFile} disabled={render.isPending}><Share2 className="size-4" aria-hidden />Chia sẻ</Button>
        </div>
        <button type="button" onClick={() => setPost(true)} className="mt-1.5 flex min-h-10 w-full items-center justify-center gap-1.5 text-sm font-semibold text-brand">
          <Megaphone className="size-4" aria-hidden />Đăng lên bảng tin CLB trên RaceHub
        </button>
      </div>
      )}
      {saver.sheet}
      {post && <PostSheet facts={f} message={o.message} render={() => render.mutateAsync('image/jpeg')} onClose={() => setPost(false)} />}
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold">{title}</h2>
      {children}
      {note && <p className="text-xs text-fg-subtle">{note}</p>}
    </section>
  )
}

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} title={title}
      className={cn('inline-flex min-h-9 items-center gap-1 rounded-full border px-3 py-1.5 text-left text-sm',
        on ? 'border-brand bg-brand/15 font-semibold text-fg' : 'border-border text-fg-muted hover:bg-surface-2')}>
      {children}
    </button>
  )
}

/** Đăng ảnh lên bảng tin một CLB mình tham gia — luôn hỏi trước */
function PostSheet({ facts: f, message, render, onClose }: {
  facts: VicFacts; message: string; render: () => Promise<{ blob: Blob; code: string }>; onClose: () => void
}) {
  const { profile } = useMyProfile()
  const clubs = useClubInbox()
  const list = (clubs.data ?? []).filter((c) => c.member_status === 'APPROVED')
  const [club, setClub] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: async () => {
      if (!club || !profile) throw new Error('NO_CLUB')
      const { blob, code } = await render()
      const path = await uploadPostImage(club, profile.id, new File([blob], `vinh-danh-${code}.jpg`, { type: 'image/jpeg' }))
      const who = f.person.id === profile.id ? '' : `${f.person.display_name} · `
      const body = [`🏅 ${who}${f.headline}: ${f.title}`, message.trim(), `Xác thực: ${window.location.origin}/v/${code}`].filter(Boolean).join('\n')
      await createPost({ clubId: club, body, imagePaths: [path] })
    },
    onSuccess: () => { toast.success('Đã đăng lên bảng tin CLB'); onClose() },
    onError: (e) => toast.error((e as Error).message === 'IMAGE_SIZE' ? 'Ảnh quá lớn để đăng. Chọn khổ nhỏ hơn.' : victoryErrorMessage(e)),
  })
  return (
    <Sheet open onClose={onClose} title="Đăng lên bảng tin CLB" description="Ảnh sẽ hiện trên bảng tin CLB và Bảng tin cộng đồng của thành viên."
      footer={<Button block disabled={!club} loading={send.isPending} onClick={() => send.mutate()}>Đăng ảnh</Button>}>
      {clubs.isPending ? <Skeleton className="h-24" /> : !list.length ? (
        <p className="py-6 text-center text-sm text-fg-muted">Bạn chưa tham gia CLB nào. Hãy lưu ảnh rồi chia sẻ lên mạng xã hội.</p>
      ) : (
        <ul className="space-y-1">
          {list.map((c) => (
            <li key={c.club_id}>
              <button type="button" onClick={() => setClub(c.club_id)} aria-pressed={club === c.club_id}
                className={cn('flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-left', club === c.club_id ? 'border-brand bg-brand/10' : 'border-border')}>
                <Avatar src={c.avatar_url} name={c.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
                {club === c.club_id && <Check className="size-4 text-brand" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}

/** BTC chọn runner trong thử thách để vinh danh (tìm tên, xem hạng + kết quả) */
function ParticipantPicker({ challengeId, onPick }: { challengeId: string; onPick: (id: string) => void }) {
  const q = useQuery({ queryKey: victoryKeys.participants(challengeId), queryFn: () => getParticipants(challengeId) })
  const [term, setTerm] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const list = (q.data ?? []).filter((p) => !term.trim() || matchesSearch(term, p.display_name ?? ''))
  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Chọn runner để vinh danh" subtitle="Số liệu lấy từ kết quả thử thách; bạn đặt danh hiệu ở bước sau" fallback={routes.victory} />
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Tìm tên runner" aria-label="Tìm runner" className="pl-9" />
      </div>
      {q.isPending ? <div className="space-y-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
        : q.isError ? <ErrorState message={victoryErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : !list.length ? <EmptyState icon={UserRound} title="Không có runner phù hợp" />
        : (
          <Card className="divide-y divide-border overflow-hidden p-0">
            {list.map((p) => (
              <button key={p.user_id} type="button" onClick={() => (Number(p.score) > 0 ? onPick(p.user_id) : setConfirm(p.display_name))}
                className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2">
                <span className="w-7 text-center font-mono text-sm font-bold text-fg-muted">{p.rank}</span>
                <Avatar src={p.avatar_url} name={p.display_name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.display_name ?? 'Runner'}</span>
                <span className="text-xs text-fg-muted">{String(p.score).replace('.', ',')}</span>
              </button>
            ))}
          </Card>
        )}
      <ConfirmSheet open={!!confirm} onClose={() => setConfirm(null)} danger={false} confirmLabel="Đã hiểu" onConfirm={() => setConfirm(null)}
        title={`${confirm ?? 'Runner này'} chưa có kết quả`} description="Cần ít nhất một bài chạy hợp lệ trong thử thách mới tạo được ảnh vinh danh." />
    </div>
  )
}
