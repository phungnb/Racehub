'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, Field, Input, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatNumber } from '@/shared/lib/format'
import { challengeErrorMessage, getConquestBoard, updateChallenge, type ChallengeDetail, type ChallengeEdit, type ConquestBoard } from '../../api/challengeApi'
import {
  conquestPayload, DEFAULT_CONQUEST, DEFAULT_PLEDGE, defaultDraft, formatClock, isConquest, objectiveChoices, OBJECTIVE_META, pledgePayload, TEAM_MODE_META,
  validateConquest, validatePledge, validateTeamSize, type ChallengeDraft, type Objective, type TeamMode,
} from '../../model/challenge'
import { challengeKeys } from '../../hooks/useChallenge'
import { ConquestSection, objectivesFor, PledgeSection } from '../wizard/CreateChallengeScreen'

const toLocalInput = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')))

/**
 * Sửa thử thách trước khi bắt đầu (013100, mở rộng 013300): người tạo / BTC sửa được mọi hạng mục — tên, mô tả, thời gian,
 * cách tính điểm, mục tiêu (cả mốc tự đăng ký / hạng mục chinh phục), luật km / pace, đội, số người, đối tượng, thưởng, nhịp tim.
 * Chỉ thể thức và CLB tổ chức là giữ nguyên. Sau giờ bắt đầu: không sửa được nữa.
 */
export function EditChallengeCard({ d }: { d: ChallengeDetail }) {
  const [open, setOpen] = useState(false)
  return (
    <Card className="flex items-center gap-3">
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">Thử thách chưa bắt đầu</p>
        <p className="text-xs text-fg-muted">Bạn còn sửa được mọi hạng mục: luật, mục tiêu, thời gian, số người, thưởng… Người đã tham gia sẽ nhận thông báo.</p>
      </div>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Pencil className="size-4" aria-hidden />Sửa</Button>
      {open && <EditChallengeSheet d={d} onClose={() => setOpen(false)} />}
    </Card>
  )
}

function EditChallengeSheet({ d, onClose }: { d: ChallengeDetail; onClose: () => void }) {
  const c = d.challenge
  // Thử thách chinh phục: tải các hạng mục hiện có trước khi mở form
  const q = useQuery({ queryKey: challengeKeys.conquest(c.id), queryFn: () => getConquestBoard(c.id), enabled: isConquest(c.objective) })
  if (isConquest(c.objective) && !q.data) {
    return (
      <Sheet open onClose={onClose} title="Sửa thử thách">
        {q.isError ? <p className="text-sm text-danger">{challengeErrorMessage(q.error)}</p> : <Skeleton className="h-64" />}
      </Sheet>
    )
  }
  return <EditForm d={d} board={q.data ?? null} onClose={onClose} />
}

function EditForm({ d, board, onClose }: { d: ChallengeDetail; board: ConquestBoard | null; onClose: () => void }) {
  const c = d.challenge
  const qc = useQueryClient()
  const team = c.format === 'TEAM'
  const club = !!c.target_club_id
  const personal = c.format === 'SOLO_GOAL' && c.max_slots <= 1
  const [title, setTitle] = useState(c.title)
  const [desc, setDesc] = useState(c.description ?? '')
  const [target, setTarget] = useState(String(c.target_value ?? 0))
  const [minKm, setMinKm] = useState(String(c.min_km ?? 0))
  const [minPace, setMinPace] = useState(String(c.min_pace ?? 3))
  const [maxPace, setMaxPace] = useState(String(c.max_pace ?? 15))
  const [cap, setCap] = useState(c.daily_cap_km ? String(c.daily_cap_km) : '')
  const [start, setStart] = useState(() => toLocalInput(c.start_date))
  const [end, setEnd] = useState(() => toLocalInput(c.end_date))
  const [slots, setSlots] = useState(String(c.max_slots))
  const [reward, setReward] = useState(String(c.reward_xu ?? 0))
  const [audience, setAudience] = useState(c.target_audience)
  const [requireHr, setRequireHr] = useState(!!c.require_hr)
  const [mode, setMode] = useState<TeamMode>((c.game_mode as TeamMode) ?? 'TEAM_SUM')
  const teams = [...(d.teams ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const [teamNames, setTeamNames] = useState(() => teams.map((t) => t.name))
  // Luật dạng nháp tạo mới để dùng lại các phần của trình tạo (mục tiêu tự đăng ký, hạng mục chinh phục)
  const [rules, setRules] = useState<ChallengeDraft>(() => ({
    ...defaultDraft(new Date(c.start_date), c.target_club_id),
    format: c.format, objective: c.objective,
    pledge: c.pledge_enabled ? {
      enabled: true, options: (c.pledge_options ?? []).map(Number), minKm: Number(c.pledge_min_km ?? DEFAULT_PLEDGE.minKm),
      maxKm: Number(c.pledge_max_km ?? DEFAULT_PLEDGE.maxKm), capPct: c.pledge_cap_pct == null ? null : Number(c.pledge_cap_pct),
      teamSize: Number(c.pledge_team_size ?? DEFAULT_PLEDGE.teamSize),
    } : { ...DEFAULT_PLEDGE },
    conquest: board?.categories.length ? {
      mode: board.mode ?? 'FIXED',
      tolerancePct: Number(board.tolerance_pct ?? c.conquest_tolerance_pct ?? 1),
      categories: board.categories.map((x) => ({ label: x.label, km: x.distance_m / 1000, target: x.target_s ? formatClock(x.target_s) : '' })),
    } : { ...DEFAULT_CONQUEST, categories: DEFAULT_CONQUEST.categories.map((x) => ({ ...x })) },
  }))
  const setR = (p: Partial<ChallengeDraft>) => setRules((r) => ({ ...r, ...p }))
  const conquest = isConquest(rules.objective)
  const soloPledgeAllowed = c.format === 'SOLO_GOAL' && rules.objective === 'DISTANCE' && !personal
  const pledge = (team && !!c.pledge_enabled) || (soloPledgeAllowed && rules.pledge.enabled)
  const objectives = (team && c.pledge_enabled) ? ['DISTANCE' as Objective] : objectivesFor({ format: c.format })

  const ruleError = conquest ? validateConquest(rules.conquest, rules.objective)
    : pledge ? validatePledge({ ...rules.pledge, enabled: true }) ?? (team ? validateTeamSize(rules.pledge.teamSize) : null) : null
  const save = useMutation({
    mutationFn: () => {
      const p: ChallengeEdit = {
        title: title.trim(), description: desc.trim() || null, target_value: conquest || pledge ? c.target_value : num(target),
        min_km: num(minKm) || 0, min_pace: num(minPace), max_pace: num(maxPace), daily_cap_km: cap.trim() ? num(cap) : null,
        start_date: new Date(start).toISOString(), end_date: new Date(end).toISOString(),
        require_hr: requireHr,
      }
      if (conquest) p.conquest = conquestPayload(rules)
      else p.objective = rules.objective
      if (team && !c.pledge_enabled) { p.game_mode = mode; p.team_names = teamNames.map((n) => n.trim()) }
      if (team && c.pledge_enabled) p.pledge = pledgePayload(rules.pledge, true)
      else if (soloPledgeAllowed && rules.pledge.enabled) p.pledge = pledgePayload(rules.pledge)
      else if (c.pledge_enabled && !team) p.pledge = null
      if (c.format !== 'DUEL' && !personal) p.max_slots = Math.round(num(slots))
      if (club) p.reward_xu = num(reward) || 0
      if (!club && c.format !== 'DUEL' && !personal) p.audience = audience
      return updateChallenge(c.id, p)
    },
    onSuccess: (r) => {
      const money = [r?.fee_extra > 0 && `trừ ${formatNumber(r.fee_extra)} Xu phí tăng quy mô`,
        r?.reward_diff > 0 && `ký quỹ thêm ${formatNumber(r.reward_diff)} Xu thưởng`, r?.reward_diff < 0 && `hoàn ${formatNumber(-r.reward_diff)} Xu thưởng về quỹ CLB`]
        .filter(Boolean).join(', ')
      toast.success(`Đã lưu thay đổi và báo người tham gia${money ? ` (${money})` : ''}`)
      void qc.invalidateQueries({ queryKey: ['challenge', c.id] })
      void qc.invalidateQueries({ queryKey: ['challenges'] })
      onClose()
    },
    onError: (e) => toast.error(challengeErrorMessage(e)),
  })
  const valid = title.trim().length >= 3 && !!start && !!end && Date.parse(end) > Date.parse(start)
    && (conquest || pledge || Number.isFinite(num(target))) && Number.isFinite(num(minPace)) && Number.isFinite(num(maxPace))
    && (c.format === 'DUEL' || personal || num(slots) >= Math.max(1, d.stats.participants)) && (!club || num(reward) >= 0)
    && !ruleError && (!team || c.pledge_enabled || teamNames.every((n) => n.trim()))
  const slotsLow = Number.isFinite(num(slots)) && num(slots) < d.stats.participants
  return (
    <Sheet open onClose={onClose} title="Sửa thử thách"
      description="Chỉ sửa được trước giờ bắt đầu. Thể thức và CLB tổ chức giữ nguyên; người đã tham gia nhận thông báo."
      footer={<Button block loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>Lưu thay đổi</Button>}>
      <div className="space-y-4">
        <Field label="Tên thử thách" htmlFor="ec-title"><Input id="ec-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Mô tả" htmlFor="ec-desc"><Textarea id="ec-desc" rows={4} maxLength={2000} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bắt đầu" htmlFor="ec-start"><Input id="ec-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Kết thúc" htmlFor="ec-end" hint="Tối đa 1 năm"><Input id="ec-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>

        {objectives.length > 1 && (
          <Field label="Tính điểm theo">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tính điểm theo">
              {objectiveChoices(objectives, { objective: rules.objective, mode: rules.conquest.mode }).map((x) => (
                <button key={x.id} type="button" role="radio" aria-checked={x.active}
                  onClick={() => setR({ objective: x.objective, ...(x.mode ? { conquest: { ...rules.conquest, mode: x.mode } } : {}) })}
                  className={cn('min-h-9 rounded-full border px-3 text-sm font-medium', x.active ? 'border-brand bg-brand/15' : 'border-border text-fg-muted')}>
                  {x.meta.label}
                </button>
              ))}
            </div>
          </Field>
        )}
        {conquest && <ConquestSection d={rules} set={setR} error={ruleError ?? undefined} />}
        {(soloPledgeAllowed || (team && c.pledge_enabled)) && <PledgeSection d={rules} set={setR} error={ruleError ?? undefined} />}
        {!conquest && !pledge && (
          <Field label={`Mục tiêu (${OBJECTIVE_META[rules.objective]?.unit ?? ''})`} htmlFor="ec-target" hint={c.format === 'RANKED' ? '0 = không đặt mục tiêu' : undefined}>
            <Input id="ec-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          {!conquest && <Field label={rules.objective === 'STREAK_DAYS' ? 'Mỗi ngày tối thiểu (km)' : 'Mỗi bài tối thiểu (km)'} htmlFor="ec-minkm">
            <Input id="ec-minkm" inputMode="decimal" value={minKm} onChange={(e) => setMinKm(e.target.value)} /></Field>}
          <Field label="Trần km mỗi ngày" htmlFor="ec-cap" hint="Để trống = không giới hạn"><Input id="ec-cap" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} /></Field>
          <Field label="Pace nhanh nhất (phút/km)" htmlFor="ec-minpace"><Input id="ec-minpace" inputMode="decimal" value={minPace} onChange={(e) => setMinPace(e.target.value)} /></Field>
          <Field label="Pace chậm nhất (phút/km)" htmlFor="ec-maxpace"><Input id="ec-maxpace" inputMode="decimal" value={maxPace} onChange={(e) => setMaxPace(e.target.value)} /></Field>
        </div>
        <label className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm">
          <input type="checkbox" checked={requireHr} onChange={(e) => setRequireHr(e.target.checked)} className="size-5 accent-[var(--color-brand)]" />
          Bắt buộc có nhịp tim (bài không có nhịp tim không được tính)
        </label>

        {team && !c.pledge_enabled && (
          <div className="space-y-3">
            <Field label="Cách tính điểm đội">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Cách tính điểm đội">
                {(Object.keys(TEAM_MODE_META) as TeamMode[]).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                    className={cn('min-h-9 rounded-full border px-3 text-sm font-medium', mode === m ? 'border-brand bg-brand/15' : 'border-border text-fg-muted')}>
                    {TEAM_MODE_META[m].label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Tên đội">
              <div className="grid grid-cols-2 gap-2">
                {teamNames.map((n, i) => (
                  <Input key={teams[i]?.team_id ?? i} value={n} maxLength={40} aria-label={`Tên đội ${i + 1}`}
                    onChange={(e) => setTeamNames((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} />
                ))}
              </div>
            </Field>
          </div>
        )}

        {c.format !== 'DUEL' && !personal && (
          <Field label="Số người tối đa" htmlFor="ec-slots" error={slotsLow ? `Đã có ${d.stats.participants} người tham gia — không đặt thấp hơn.` : null}
            hint="Tăng lên mức quy mô cao hơn sẽ trừ phần phí chênh (ví của bạn hoặc quỹ CLB) nếu lượt miễn phí / hạn mức CLB không bao được; giảm không hoàn phí.">
            <Input id="ec-slots" inputMode="numeric" value={slots} onChange={(e) => setSlots(e.target.value)} />
          </Field>
        )}
        {club && (
          <Field label="Thưởng Xu (trích quỹ CLB)" htmlFor="ec-reward"
            hint="Tăng thưởng: quỹ CLB ký quỹ thêm phần chênh. Giảm: phần chênh hoàn về quỹ CLB ngay. Tối đa 50% quỹ.">
            <Input id="ec-reward" inputMode="numeric" value={reward} onChange={(e) => setReward(e.target.value)} />
          </Field>
        )}
        {!club && c.format !== 'DUEL' && !personal && (
          <Field label="Ai được tham gia">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Ai được tham gia">
              {(['PUBLIC', 'INVITE_ONLY'] as const).map((a) => (
                <button key={a} type="button" role="radio" aria-checked={audience === a} onClick={() => setAudience(a)}
                  className={cn('min-h-11 rounded-xl border px-3 text-sm font-medium', audience === a ? 'border-brand bg-brand/15' : 'border-border text-fg-muted')}>
                  {a === 'PUBLIC' ? 'Công khai' : 'Chỉ người có mã mời'}
                </button>
              ))}
            </div>
          </Field>
        )}
        <p className="text-xs text-fg-muted">Thể thức (cá nhân / cộng đồng / đồng đội / 1-1) và CLB tổ chức không đổi được. Cần đổi thì huỷ và tạo thử thách mới.</p>
      </div>
    </Sheet>
  )
}
