'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ExternalLink, Gift, Plus, Trophy, Users, X } from 'lucide-react'
import { Avatar, Button, Card, ErrorState, Field, Input, RankSearch, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { filterSearch } from '@/shared/lib/search'
import { ClubAvatar, CreateClubSheet } from '@/features/club'
import { cupErrorMessage, getRunnerBoard, reviewCupClub, setRewardForm, type Cup } from '../api/cupApi'
import { formatPaceS } from '../model/match'
import { useMatchMutation } from './MatchParts'

const num = (v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 1 })

/** Luật riêng của giải online dạng câu ngắn */
export function leagueRules(l: NonNullable<Cup['league']>): string[] {
  const out: string[] = []
  if (l.min_run_km) out.push(`Bài chạy tối thiểu ${num(l.min_run_km)} km mới được tính`)
  if (l.min_pace || l.max_pace) out.push(`Pace hợp lệ ${l.min_pace ?? 0}–${l.max_pace ?? '…'} phút/km`)
  if (l.member_min_km) out.push(`Mỗi thành viên chạy tối thiểu ${num(l.member_min_km)} km được xem là thành tích hợp lệ`)
  if (l.member_min_km && l.min_valid_pct) out.push(`CLB cần ít nhất ${l.min_valid_pct}% thành viên đăng ký có thành tích hợp lệ mới được xếp hạng`)
  if (l.require_club_approval) out.push('CLB phải đủ số thành viên tối thiểu và được ban tổ chức duyệt mới vào giải')
  return out
}

/** Số runner đã đăng ký so với giới hạn + luật giải online + link form nhận giải */
export function LeagueBox({ c }: { c: Cup }) {
  const l = c.league
  const [edit, setEdit] = useState(false)
  if (!l) return null
  const rules = leagueRules(l)
  const full = l.max_runners != null && l.signed_runners >= l.max_runners
  const pct = l.max_runners ? Math.min(100, Math.round((l.signed_runners / l.max_runners) * 100)) : 0
  return (
    <Card className="space-y-3 p-4">
      {l.max_runners != null && (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-bold"><Users className="size-4 text-brand" aria-hidden />Runner đăng ký sớm</p>
            <p className="font-mono text-sm font-bold tabular">{l.signed_runners.toLocaleString('vi-VN')} / {l.max_runners.toLocaleString('vi-VN')}</p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={l.max_runners} aria-valuenow={l.signed_runners}>
            <div className={cn('h-full rounded-full', full ? 'bg-danger' : 'bg-brand')} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-fg-muted">
            {full ? 'Đã đủ người — đóng đăng ký thi đấu.' : `Còn ${(l.max_runners - l.signed_runners).toLocaleString('vi-VN')} suất. Đủ ${l.max_runners.toLocaleString('vi-VN')} runner đăng ký sớm nhất là đóng.`}
          </p>
        </div>
      )}
      {rules.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {rules.map((r) => <li key={r} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />{r}</li>)}
        </ul>
      )}
      <RewardForm c={c} onEdit={() => setEdit(true)} />
      {edit && <RewardFormSheet c={c} onClose={() => setEdit(false)} />}
    </Card>
  )
}

function RewardForm({ c, onEdit }: { c: Cup; onEdit: () => void }) {
  const l = c.league
  if (!l) return null
  const manage = c.can_manage
  if (!l.has_reward_form && !manage) return null
  return (
    <div className="space-y-2 rounded-xl bg-surface-2 p-3">
      <p className="flex items-center gap-2 text-sm font-bold"><Gift className="size-4 text-coin" aria-hidden />Nhận giải (áo, đai)</p>
      {l.reward_form_url ? (
        <>
          {l.my_prize?.qualified && <p className="text-sm">Chúc mừng! Bạn thuộc nhóm đạt giải — điền form để ban tổ chức gửi quà.</p>}
          <a href={l.reward_form_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-brand-fg">
            Điền form nhận giải<ExternalLink className="size-4" aria-hidden />
          </a>
        </>
      ) : l.has_reward_form ? (
        <p className="text-sm text-fg-muted">
          {c.status === 'FINISHED'
            ? (l.my_prize?.qualified ? '' : 'Link form chỉ hiện cho CLB và runner đạt giải. Ban tổ chức sẽ công bố danh sách đạt giải.')
            : 'Ban tổ chức đã chuẩn bị form nhận giải. Link hiện cho người đạt giải khi kết quả được chốt chính thức.'}
        </p>
      ) : (
        <p className="text-sm text-fg-muted">Chưa có link form nhận giải. Dán link để người đạt giải điền thông tin nhận áo, đai.</p>
      )}
      {manage && <Button size="sm" variant="secondary" onClick={onEdit}>{l.has_reward_form ? 'Sửa link form' : 'Dán link form'}</Button>}
    </div>
  )
}

function RewardFormSheet({ c, onClose }: { c: Cup; onClose: () => void }) {
  const [url, setUrl] = useState(c.league?.reward_form_url ?? '')
  const save = useMatchMutation(c.id, () => setRewardForm(c.id, url.trim()), 'Đã lưu link form nhận giải')
  const done = () => { save.mutate(undefined, { onSuccess: onClose }) }
  return (
    <Sheet open onClose={onClose} title="Link form nhận giải" description="Chỉ CLB và runner đạt giải mới thấy link, sau khi kết quả được chốt chính thức. Để trống để xóa."
      footer={<Button block onClick={done} loading={save.isPending}>Lưu</Button>}>
      <Field label="Link (https://…)" htmlFor="reward-url">
        <Input id="reward-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://forms.gle/…" inputMode="url" autoCapitalize="off" spellCheck={false} />
      </Field>
    </Sheet>
  )
}

/** Ban tổ chức: duyệt / từ chối CLB đang chờ vào giải */
export function PendingClubs({ c }: { c: Cup }) {
  const pending = c.league?.pending_clubs ?? []
  const [reject, setReject] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const approve = useMatchMutation(c.id, (club: string) => reviewCupClub(c.id, club, true), 'Đã duyệt CLB vào giải')
  const deny = useMatchMutation(c.id, (club: string) => reviewCupClub(c.id, club, false, note), 'Đã từ chối, CLB nhận được lý do')
  if (!c.can_manage || !pending.length) return null
  const target = pending.find((p) => p.club_id === reject)
  return (
    <Card className="space-y-2 border-warning/40 p-4">
      <p className="text-sm font-bold">CLB chờ duyệt ({pending.length})</p>
      {pending.map((p) => (
        <div key={p.club_id} className="flex items-center gap-3 rounded-xl border border-border p-2.5">
          <ClubAvatar club={{ name: p.name, avatar_url: p.avatar_url, accent_color: p.accent_color }} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{p.name}</span>
            <span className="block text-[11px] text-fg-muted">{p.members} thành viên</span>
          </span>
          <Button size="sm" onClick={() => approve.mutate(p.club_id)} loading={approve.isPending && approve.variables === p.club_id} aria-label={`Duyệt ${p.name}`}><Check className="size-4" aria-hidden /></Button>
          <Button size="sm" variant="danger" onClick={() => { setReject(p.club_id); setNote('') }} aria-label={`Từ chối ${p.name}`}><X className="size-4" aria-hidden /></Button>
        </div>
      ))}
      <Sheet open={!!target} onClose={() => setReject(null)} title={`Từ chối ${target?.name ?? 'CLB'}`} description="Ban quản trị CLB sẽ nhận lý do này."
        footer={<Button block variant="danger" loading={deny.isPending} disabled={note.trim().length < 3}
          onClick={() => reject && deny.mutate(reject, { onSuccess: () => setReject(null) })}>Từ chối</Button>}>
        <Field label="Lý do" htmlFor="club-reject"><Textarea id="club-reject" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="VD: CLB chưa đủ thành viên thật" /></Field>
      </Sheet>
    </Card>
  )
}

/** Runner chưa có CLB: tạo CLB ngay trong màn giải. Tạo xong là Chủ nhiệm, mời đủ người rồi đăng ký CLB vào giải */
export function CreateClubPrompt({ c }: { c: Cup }) {
  const [open, setOpen] = useState(false)
  const [minRoster] = useState(c.min_roster)
  if (c.my_clubs.length > 0 || c.status !== 'OPEN') return null
  return (
    <Card className="space-y-2 p-4">
      <p className="text-sm font-bold">Bạn chưa có CLB</p>
      <p className="text-sm text-fg-muted">
        Giải thi đấu theo CLB. Tạo CLB của bạn, mời đủ {minRoster} thành viên, rồi bấm Đăng ký CLB vào giải{c.league?.require_club_approval ? ' (ban tổ chức duyệt trước khi tính)' : ''}.
        Hoặc nhập mã mời để vào CLB đã có.
      </p>
      <Button block onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden />Tạo CLB</Button>
      <CreateClubSheet open={open} onClose={() => setOpen(false)} />
    </Card>
  )
}

/** BXH cá nhân trong giải: tìm runner, xem km, CLB, đạt km hợp lệ chưa */
export function RunnerBoard({ c }: { c: Cup }) {
  const q = useQuery({ queryKey: ['cup', c.id, 'runners'], queryFn: () => getRunnerBoard(c.id), refetchInterval: c.phase === 'LIVE' ? 60_000 : false })
  const [term, setTerm] = useState('')
  const rows = q.data?.rows ?? []
  const shown = filterSearch(rows, term, (r) => [r.display_name, r.club_name])
  const min = q.data?.member_min_km
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-bold"><Trophy className="size-4 text-fg-muted" aria-hidden />Bảng xếp hạng cá nhân</h2>
      {min ? <p className="text-xs text-fg-muted">Xếp theo tổng km tính điểm (đã áp trần ngày). Đạt {num(min)} km là thành tích hợp lệ.</p> : null}
      {q.isPending ? <Skeleton className="h-40" /> : q.isError ? <ErrorState message={cupErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : !rows.length ? <p className="py-4 text-center text-sm text-fg-muted">Chưa có runner nào đăng ký.</p> : (
          <>
            {rows.length > 5 && <RankSearch value={term} onChange={setTerm} total={rows.length} matched={shown.length} placeholder="Tìm runner hoặc CLB…" />}
            <ol className="space-y-1.5">
              {shown.slice(0, 100).map((r) => (
                <li key={r.user_id} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2">
                  <span className="w-7 text-center font-mono text-sm font-bold text-fg-muted">{r.rank}</span>
                  <Avatar src={r.avatar_url} name={r.display_name} size="xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{r.display_name ?? 'Runner'}</span>
                    <span className="block truncate text-[11px] text-fg-muted">{r.club_name} · {r.days} ngày chạy{r.pace_s ? ` · ${formatPaceS(r.pace_s)}` : ''}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-sm font-bold tabular">{num(r.km)} km</span>
                    {min ? <span className={cn('block text-[10px] font-semibold', r.valid ? 'text-brand' : 'text-fg-subtle')}>{r.valid ? 'Hợp lệ' : `Cần ${num(Math.max(0, min - r.km))} km nữa`}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
            {shown.length > 100 && <p className="text-center text-xs text-fg-muted">Hiển thị 100 runner đầu. Dùng ô tìm kiếm để xem người khác.</p>}
          </>
        )}
    </section>
  )
}
