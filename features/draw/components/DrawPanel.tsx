'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Copy, Gift, History, Hourglass, ImagePlus, ListChecks, Minus, MonitorPlay, Plus, ShieldCheck, Trash2, UserMinus, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ConfirmSheet, ErrorState, Field, Input, SectionTitle, Sheet, Skeleton, SwitchRow, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { filterSearch } from '@/shared/lib/search'
import {
  cancelDraw, createDraw, drawErrorMessage, listCandidates, listDrawEvents, listDraws, runDraw, uploadSponsorLogo,
  type DrawCandidate, type DrawRule, type DrawScope, type LuckyDraw,
} from '../api/drawApi'
import { prizeProgress, resultText } from '../model/stage'
import { DrawStage } from './DrawStage'
import { ReviewActions } from './ReviewActions'

const PASTE = 'Dán danh sách tên'
const RULES: Record<DrawScope, Partial<Record<DrawRule, string>>> = {
  ORG_CAMPAIGN: { COMPLETED: 'Người đạt mục tiêu', ACTIVE: 'Người có chạy trong chiến dịch', ALL: 'Mọi người tham gia', PICKED: 'BTC tự chọn danh sách', MANUAL: PASTE },
  CHALLENGE: { COMPLETED: 'Người hoàn thành thử thách', ACTIVE: 'Người đã có thành tích', ALL: 'Mọi người tham gia', PICKED: 'BTC tự chọn danh sách', MANUAL: PASTE },
  RACE: { COMPLETED: 'VĐV đã về đích', ALL: 'Mọi VĐV đăng ký', PICKED: 'BTC tự chọn danh sách', MANUAL: PASTE },
  CLUB: { EVENT: 'Người có mặt tại một buổi (đã điểm danh)', ACTIVE: 'Thành viên có chạy 30 ngày qua', ALL: 'Mọi thành viên', PICKED: 'BTC tự chọn danh sách', MANUAL: PASTE },
  SYSTEM: { ACTIVE: 'Runner có chạy 30 ngày qua', ALL: 'Mọi tài khoản', MANUAL: PASTE },
}
const RULE_HINT: Partial<Record<DrawRule, string>> = {
  PICKED: 'Tích từng người: người được đề cử, người có mặt tại buổi lễ…',
  EVENT: 'Chỉ ai đã quét QR hoặc được ban quản trị điểm danh — không gọi tên người vắng',
  MANUAL: 'Khách mời, người chưa có tài khoản, danh sách từ Google Form… Mỗi dòng một người',
}
const STATUS: Record<LuckyDraw['status'], [string, string]> = {
  READY: ['Chờ quay', 'bg-surface-2'], LIVE: ['Đang quay', 'bg-danger/20 text-danger'], PENDING: ['Chờ xác nhận', 'bg-warning/20 text-warning'],
  DONE: ['Đã công bố', 'bg-coin/20 text-coin'], CANCELLED: ['Đã huỷ', 'bg-surface-2'],
}

/** Quay thưởng dùng chung: danh sách lượt quay; BTC tạo, mở màn hình quay trên sân khấu hoặc quay nhanh; thành viên xem trực tiếp + kết quả */
export function DrawPanel({ scope, refId, canManage, className }: { scope: DrawScope; refId: string | null; canManage: boolean; className?: string }) {
  const q = useQuery({ queryKey: ['draws', scope, refId], queryFn: () => listDraws(scope, refId), refetchInterval: (x) => (x.state.data?.some((d) => d.status === 'LIVE') ? 5000 : x.state.data?.some((d) => d.status === 'PENDING') ? 15_000 : false) })
  const [creating, setCreating] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  // Lượt vừa tạo: mở màn hình quay ngay bằng dữ liệu máy chủ trả về, không chờ danh sách tải lại
  // (trước đây nếu danh sách chưa / không tải lại được thì bấm "Tạo & mở màn hình quay" không thấy gì mở ra)
  const [created, setCreated] = useState<LuckyDraw | null>(null)
  const list = q.data ?? []
  const staged = list.find((d) => d.id === stage) ?? (created?.id === stage ? created : undefined)
  const shown = (d: LuckyDraw) => canManage || d.status === 'DONE' || d.status === 'LIVE' || d.status === 'PENDING'
  if (!canManage && !list.some(shown)) return null
  return (
    <section className={cn('space-y-2', className)}>
      <SectionTitle action={canManage ? <Button size="sm" variant="secondary" onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden />Tạo lượt quay</Button> : undefined}>
        Quay thưởng
      </SectionTitle>
      {canManage && !list.length && (
        <p className="rounded-xl border border-dashed border-border p-3 text-sm text-fg-muted">
          Tạo lượt quay may mắn cho người đủ điều kiện hoặc danh sách BTC tự chọn. Quay trực tiếp trên máy chiếu từng giải một, người trúng vắng mặt thì quay lại; kết quả công khai kèm mã kiểm chứng.
        </p>
      )}
      {canManage && q.isError && <ErrorState message={drawErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />}
      <ul className="space-y-2">
        {list.filter(shown).map((d) => (
          <li key={d.id}><DrawCard d={d} scope={scope} refId={refId} onStage={() => setStage(d.id)} /></li>
        ))}
      </ul>
      {creating && <CreateDrawSheet scope={scope} refId={refId} onClose={() => setCreating(false)} onCreated={(d) => { setCreated(d); setStage(d.id) }} />}
      {staged && <DrawStage key={staged.id} draw={staged} scope={scope} refId={refId} onClose={() => setStage(null)} />}
    </section>
  )
}

function DrawCard({ d, scope, refId, onStage }: { d: LuckyDraw; scope: DrawScope; refId: string | null; onStage: () => void }) {
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState<'run' | 'cancel' | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['draws', scope, refId] })
  const run = useMutation({
    mutationFn: () => runDraw(d.id),
    onSuccess: () => { setConfirm(null); refresh() },
    onError: (e) => { setConfirm(null); toast.error(drawErrorMessage(e)) },
  })
  const cancel = useMutation({
    mutationFn: () => cancelDraw(d.id),
    onSuccess: () => { setConfirm(null); refresh() },
    onError: (e) => { setConfirm(null); toast.error(drawErrorMessage(e)) },
  })
  const rules = RULES[scope]
  const progress = prizeProgress(d)
  const total = progress.reduce((a, p) => a + p.qty, 0)
  const won = progress.reduce((a, p) => a + p.won, 0)
  const who = d.rule === 'PICKED' ? `BTC chọn ${d.picked_count ?? 0} người`
    : d.rule === 'MANUAL' ? `Danh sách dán ${d.manual_count ?? 0} người`
    : d.rule === 'EVENT' ? `Có mặt tại: ${d.event?.title ?? 'buổi đã chọn'}` : rules[d.rule] ?? d.rule
  const copy = () => void navigator.clipboard?.writeText(resultText(d)).then(() => toast.success('Đã sao chép kết quả — dán vào Zalo / Facebook'), () => toast.error('Không sao chép được'))
  const [label, tone] = STATUS[d.status]
  return (
    <Card className={cn('space-y-3', d.status === 'DONE' && 'border-coin/40 bg-gradient-to-br from-coin/10 to-surface', d.status === 'LIVE' && 'border-danger/40', d.status === 'CANCELLED' && 'opacity-60')}>
      <div className="flex items-start gap-2">
        <Gift className="mt-0.5 size-5 shrink-0 text-coin" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{d.title}</p>
          <p className="text-xs text-fg-muted">{who}{d.excluded_count ? ` · loại trừ ${d.excluded_count}` : ''} · {d.prizes.map((p) => `${p.qty} × ${p.name}`).join(', ')}</p>
          {d.sponsor?.name && <p className="text-xs font-semibold text-coin">Nhà tài trợ: {d.sponsor.name}</p>}
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', tone)}>
          {d.status === 'LIVE' && <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-danger align-middle" />}{label}
        </span>
      </div>

      {d.status === 'READY' && d.can_manage && (
        <>
          <p className="text-sm text-fg-muted">Đủ điều kiện hiện tại: <b className="text-fg">{d.eligible_now ?? 0}</b> người{d.exclude_winners ? ' (đã loại người trúng lượt trước)' : ''} · {total} suất quà</p>
          <Button block variant="coin" disabled={!d.eligible_now} onClick={onStage}><MonitorPlay className="size-4" aria-hidden />Mở màn hình quay</Button>
          {!d.eligible_now && <p className="text-center text-xs text-warning">Chưa có ai đủ điều kiện quay ({who.toLowerCase()}). Huỷ lượt này và tạo lại với cách chọn người khác, hoặc chờ có người đạt điều kiện.</p>}
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button variant="ghost" onClick={() => setConfirm('cancel')} aria-label="Huỷ lượt quay"><Trash2 className="size-4" aria-hidden /></Button>
            <Button variant="secondary" loading={run.isPending} disabled={!d.eligible_now} onClick={() => setConfirm('run')}><Zap className="size-4" aria-hidden />Quay nhanh tất cả</Button>
          </div>
        </>
      )}

      {d.status === 'LIVE' && (
        <>
          <p className="text-sm text-fg-muted">Đã trao <b className="text-fg">{won}/{total}</b> suất · {d.entrant_count ?? 0} người trong danh sách</p>
          <Button block variant={d.can_manage ? 'coin' : 'primary'} onClick={onStage}>
            <MonitorPlay className="size-4" aria-hidden />{d.can_manage ? 'Tiếp tục quay' : 'Xem quay trực tiếp'}
          </Button>
          {d.can_manage && !d.winners.length && (
            <Button block variant="ghost" onClick={() => setConfirm('cancel')}><Trash2 className="size-4" aria-hidden />Huỷ lượt quay</Button>
          )}
        </>
      )}

      {d.status === 'PENDING' && (d.can_manage ? (
        <>
          <p className="flex items-start gap-2 rounded-xl bg-warning/10 p-2.5 text-sm text-fg-muted">
            <Hourglass className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>Kết quả <b className="text-fg">chưa chính thức</b>: chưa báo người trúng, chưa đăng bảng tin. Kiểm tra rồi bấm Chấp nhận, hoặc Huỷ kết quả để quay lại (lần huỷ được ghi lại).</span>
          </p>
          <WinnerList d={d} progress={progress} />
          <ReviewActions d={d} onDone={refresh} />
          <Button size="sm" variant="ghost" block onClick={onStage}><MonitorPlay className="size-4" aria-hidden />Xem lại màn hình quay</Button>
        </>
      ) : (
        <p className="flex items-center gap-2 text-sm text-fg-muted"><Hourglass className="size-4 shrink-0 text-warning" aria-hidden />Ban tổ chức đang xác nhận kết quả — kết quả chính thức sẽ công bố sau.</p>
      ))}

      {d.status === 'DONE' && (
        <>
          <WinnerList d={d} progress={progress} />
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={copy}><Copy className="size-4" aria-hidden />Sao chép kết quả</Button>
            <Button size="sm" variant="ghost" onClick={onStage}><MonitorPlay className="size-4" aria-hidden />Trình chiếu</Button>
          </div>
          <details className="text-[11px] text-fg-subtle">
            <summary className="flex cursor-pointer items-center gap-1"><ShieldCheck className="size-3.5" aria-hidden />Kiểm chứng</summary>
            <p className="mt-1 break-all">Quay lúc {d.run_at ? new Date(d.run_at).toLocaleString('vi-VN') : ''} trong {d.entrant_count} người đủ điều kiện (mã băm danh sách {d.entrants_hash}).
              {d.seed_hash ? ` Mã cam kết công bố lúc bắt đầu: ${d.seed_hash} = md5(seed).` : ''} Seed: {d.seed}.
              Thứ tự trúng = sắp xếp md5(seed + mã người dùng) tăng dần, chốt từ lúc bắt đầu — BTC không chọn được ai trúng, người vắng mặt được ghi công khai.
              {d.confirmed_at ? ` Ban tổ chức chấp nhận kết quả lúc ${new Date(d.confirmed_at).toLocaleString('vi-VN')}${d.confirmed_by_name ? ` (${d.confirmed_by_name})` : ''}.` : ''}</p>
          </details>
        </>
      )}

      <RejectLog d={d} />

      <ConfirmSheet open={confirm === 'run'} onClose={() => setConfirm(null)} danger={false} title="Quay nhanh tất cả?"
        description="Quay một lần cho mọi suất quà. Kết quả chờ ban tổ chức xác nhận: Chấp nhận thì mới báo người trúng và công bố; Huỷ kết quả thì quay lại. Muốn quay từng giải trước khán giả thì dùng Mở màn hình quay." confirmLabel="Quay"
        loading={run.isPending} onConfirm={() => run.mutate()} />
      <ConfirmSheet open={confirm === 'cancel'} onClose={() => setConfirm(null)} title="Huỷ lượt quay?" confirmLabel="Huỷ lượt quay"
        loading={cancel.isPending} onConfirm={() => cancel.mutate()} />
    </Card>
  )
}

/** Người trúng theo từng giải (người vắng mặt gạch ngang) */
function WinnerList({ d, progress }: { d: LuckyDraw; progress: ReturnType<typeof prizeProgress> }) {
  return (
    <div className="space-y-2">
      {progress.map((p) => {
        const ws = d.winners.filter((w) => w.prize_idx === p.idx || (w.prize_idx == null && w.prize === p.name))
        if (!ws.length) return null
        return (
          <div key={p.idx}>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-coin">{p.name}</p>
            <ol className="space-y-1">
              {ws.map((w) => (
                <li key={w.key} className={cn('flex items-center gap-3 rounded-xl px-2 py-1.5', w.me ? 'bg-brand/15' : 'bg-surface-2/60', w.status === 'ABSENT' && 'opacity-50')}>
                  <Avatar src={w.avatar_url} name={w.name} size="sm" />
                  <span className={cn('min-w-0 flex-1 truncate text-sm font-semibold', w.status === 'ABSENT' && 'line-through')}>{w.name}{w.me ? ' (bạn)' : ''}</span>
                  {w.status === 'ABSENT' && <span className="shrink-0 text-[11px] text-fg-subtle">vắng mặt</span>}
                </li>
              ))}
            </ol>
          </div>
        )
      })}
    </div>
  )
}

/** Số lần huỷ kết quả (mọi người thấy — minh bạch); chi tiết từng lần (ai, lúc nào, lý do, danh sách bị huỷ) chỉ ban tổ chức thấy */
function RejectLog({ d }: { d: LuckyDraw }) {
  const n = d.reject_count ?? 0
  if (!n) return null
  const log = d.rejections ?? []
  return (
    <details className="text-xs text-fg-muted">
      <summary className="flex cursor-pointer items-center gap-1.5"><History className="size-3.5" aria-hidden />Kết quả đã bị ban tổ chức huỷ và quay lại {n} lần</summary>
      {log.length > 0 && (
        <ol className="mt-1.5 space-y-1.5">
          {log.map((x, i) => (
            <li key={x.id} className="rounded-lg bg-surface-2/60 p-2">
              <p><b className="text-fg">Lần {i + 1}</b> · {new Date(x.at).toLocaleString('vi-VN')}{x.by_name ? ` · ${x.by_name}` : ''}</p>
              {x.reason && <p>Lý do: {x.reason}</p>}
              <p className="text-fg-subtle">Kết quả bị huỷ: {x.winners.filter((w) => w.status === 'WON').map((w) => `${w.name} (${w.prize})`).join(', ') || 'không có người trúng'}</p>
              {x.seed && <p className="break-all font-mono text-[10px] text-fg-subtle">seed {x.seed}{x.seed_hash ? ` · md5 ${x.seed_hash}` : ''}</p>}
            </li>
          ))}
        </ol>
      )}
    </details>
  )
}

function CreateDrawSheet({ scope, refId, onClose, onCreated }: { scope: DrawScope; refId: string | null; onClose: () => void; onCreated: (d: LuckyDraw) => void }) {
  const qc = useQueryClient()
  const rules = Object.keys(RULES[scope]) as DrawRule[]
  const [title, setTitle] = useState('Quay thưởng may mắn')
  const [rule, setRule] = useState<DrawRule>(rules[0])
  const [prizes, setPrizes] = useState([{ name: '', qty: 1 }])
  const [exclude, setExclude] = useState(true)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [picker, setPicker] = useState<'picked' | 'excluded' | null>(null)
  const [namesText, setNamesText] = useState('')
  const [eventId, setEventId] = useState<string | null>(null)
  const [sponsorName, setSponsorName] = useState('')
  const [sponsorLogo, setSponsorLogo] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const names = namesText.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
  const events = useQuery({ queryKey: ['draw-events', refId], queryFn: () => listDrawEvents(refId!), enabled: scope === 'CLUB' && rule === 'EVENT' && !!refId })
  const pickLogo = async (f: File | undefined) => {
    if (!f || !refId) return
    setUploading(true)
    try { setSponsorLogo(await uploadSponsorLogo(refId, f)) } catch (e) { toast.error(drawErrorMessage(e)) } finally { setUploading(false) }
  }
  const needPeople = rule === 'PICKED' || picker !== null || excluded.size > 0
  const cands = useQuery({ queryKey: ['draw-candidates', scope, refId], queryFn: () => listCandidates(scope, refId), enabled: needPeople && scope !== 'SYSTEM' })
  const create = useMutation({
    mutationFn: () => createDraw(scope, refId, {
      title: title.trim(), rule, exclude_winners: exclude,
      prizes: prizes.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), qty: p.qty })),
      picked: rule === 'PICKED' ? [...picked] : [], excluded: [...excluded],
      names: rule === 'MANUAL' ? names : [], event_id: rule === 'EVENT' ? eventId : null,
      sponsor: sponsorName.trim() ? { name: sponsorName.trim(), logo_url: sponsorLogo } : null,
    }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ['draws', scope, refId] }); onClose()
      if (d.eligible_now) { toast.success('Đã tạo lượt quay'); onCreated(d) }
      // Chưa ai đủ điều kiện thì không mở được màn hình quay — nói rõ thay vì im lặng
      else toast.info('Đã tạo lượt quay, nhưng hiện chưa có ai đủ điều kiện nên chưa mở được màn hình quay. Đổi "Ai được quay" hoặc chờ có người đạt điều kiện.', { duration: 8000 })
    },
    onError: (e) => toast.error(drawErrorMessage(e)),
  })
  const move = (i: number, dir: -1 | 1) => setPrizes((ps) => { const a = [...ps]; const j = i + dir; if (j < 0 || j >= a.length) return ps; [a[i], a[j]] = [a[j], a[i]]; return a })
  // Lý do nút Tạo bị khoá — hiện ngay dưới nút để không tưởng là nút hỏng
  const missing = title.trim().length < 3 ? 'Nhập tên lượt quay (ít nhất 3 ký tự).'
    : !prizes.some((p) => p.name.trim()) ? 'Nhập tên ít nhất một giải thưởng.'
    : rule === 'PICKED' && picked.size === 0 ? 'Chọn ít nhất một người được quay.'
    : rule === 'MANUAL' && names.length === 0 ? 'Dán danh sách tên (mỗi dòng một người).'
    : rule === 'MANUAL' && names.length > 2000 ? 'Danh sách tối đa 2.000 người.'
    : rule === 'EVENT' && !eventId ? 'Chọn một buổi của CLB.' : null
  const valid = !missing

  if (picker) {
    const set = picker === 'picked' ? picked : excluded
    return (
      <PeoplePicker title={picker === 'picked' ? 'Chọn người được quay' : 'Loại trừ khỏi lượt quay'}
        hint={picker === 'picked' ? 'Chỉ những người được tích mới có tên trong vòng quay.' : 'VD: ban tổ chức, nhà tài trợ, người đã nhận quà khác.'}
        loading={cands.isPending} people={cands.data ?? []} value={set} onClose={() => setPicker(null)}
        onChange={(s) => (picker === 'picked' ? setPicked(s) : setExcluded(s))} />
    )
  }
  return (
    <Sheet open onClose={onClose} title="Tạo lượt quay thưởng" description="Quà do ban tổ chức tự trao — RaceHub chọn người trúng minh bạch, có mã kiểm chứng."
      footer={<div className="space-y-1.5">
        <Button block loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>Tạo & mở màn hình quay</Button>
        {missing && <p className="text-center text-xs text-fg-muted">{missing}</p>}
      </div>}>
      <div className="space-y-4">
        <Field label="Tên lượt quay" htmlFor="d-title"><Input id="d-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="space-y-2">
          <p className="text-sm font-semibold">Ai được quay</p>
          <div role="radiogroup" aria-label="Ai được quay" className="grid gap-2">
            {rules.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={rule === r} onClick={() => setRule(r)}
                className={cn('rounded-xl border p-3 text-left text-sm font-semibold', rule === r ? 'border-brand/60 bg-brand/10' : 'border-border')}>
                {RULES[scope][r]}
                {RULE_HINT[r] && <span className="block text-xs font-normal text-fg-muted">{RULE_HINT[r]}</span>}
              </button>
            ))}
          </div>
          {rule === 'PICKED' && (
            <Button block variant="secondary" onClick={() => setPicker('picked')}><ListChecks className="size-4" aria-hidden />{picked.size ? `Đã chọn ${picked.size} người · sửa` : 'Chọn người'}</Button>
          )}
          {rule === 'EVENT' && (
            events.isPending ? <Skeleton className="h-24" /> : !events.data?.length ? (
              <p className="rounded-xl border border-dashed border-border p-3 text-sm text-fg-muted">Chưa có buổi nào trong 60 ngày qua. Tạo buổi ở tab Lịch rồi điểm danh bằng QR.</p>
            ) : (
              <div role="radiogroup" aria-label="Chọn buổi" className="grid gap-1.5">
                {events.data.map((e) => (
                  <button key={e.id} type="button" role="radio" aria-checked={eventId === e.id} onClick={() => setEventId(e.id)}
                    className={cn('flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm', eventId === e.id ? 'border-brand bg-brand/10' : 'border-border')}>
                    <span className="min-w-0 truncate"><b>{e.title}</b> · {new Date(e.starts_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</span>
                    <span className="shrink-0 text-xs text-fg-muted">{e.checked_in} đã điểm danh</span>
                  </button>
                ))}
              </div>
            )
          )}
          {rule === 'MANUAL' && (
            <Field label={`Danh sách người được quay (${names.length} người)`} htmlFor="d-names"
              hint="Dán từ Excel / Zalo / Google Form: mỗi dòng một người, dòng trống tự bỏ. Trùng tên vẫn tính là hai người.">
              <Textarea id="d-names" rows={6} value={namesText} onChange={(e) => setNamesText(e.target.value)} placeholder={'Nguyễn Văn An\nTrần Thị Bình\nLê Minh Cường'} />
            </Field>
          )}
          {scope !== 'SYSTEM' && rule !== 'MANUAL' && (
            <Button block variant="ghost" onClick={() => setPicker('excluded')}><UserMinus className="size-4" aria-hidden />{excluded.size ? `Loại trừ ${excluded.size} người · sửa` : 'Loại trừ người (BTC, nhà tài trợ…)'}</Button>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold">Giải thưởng</p>
          <p className="text-xs text-fg-muted">Nhập giải lớn trước. Trên màn hình quay, mặc định quay giải nhỏ trước, giải lớn sau cùng để giữ hồi hộp.</p>
          {prizes.map((p, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="flex shrink-0 flex-col">
                <button type="button" aria-label="Lên" disabled={i === 0} onClick={() => move(i, -1)} className="text-fg-subtle disabled:opacity-30"><ArrowUp className="size-3.5" aria-hidden /></button>
                <button type="button" aria-label="Xuống" disabled={i === prizes.length - 1} onClick={() => move(i, 1)} className="text-fg-subtle disabled:opacity-30"><ArrowDown className="size-3.5" aria-hidden /></button>
              </div>
              <Input value={p.name} maxLength={80} placeholder={i === 0 ? 'VD: Giải nhất — Giày chạy' : 'Tên giải'} aria-label={`Giải ${i + 1}`}
                onChange={(e) => setPrizes(prizes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <div className="flex shrink-0 items-center">
                <Button size="sm" variant="ghost" aria-label="Bớt" onClick={() => setPrizes(prizes.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}><Minus className="size-4" aria-hidden /></Button>
                <span className="w-6 text-center font-mono text-sm">{p.qty}</span>
                <Button size="sm" variant="ghost" aria-label="Thêm" onClick={() => setPrizes(prizes.map((x, j) => (j === i ? { ...x, qty: Math.min(100, x.qty + 1) } : x)))}><Plus className="size-4" aria-hidden /></Button>
              </div>
              {prizes.length > 1 && <Button size="sm" variant="ghost" aria-label="Xoá giải" onClick={() => setPrizes(prizes.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>}
            </div>
          ))}
          {prizes.length < 10 && <Button size="sm" variant="secondary" onClick={() => setPrizes([...prizes, { name: '', qty: 1 }])}><Plus className="size-4" aria-hidden />Thêm giải</Button>}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold">Nhà tài trợ (không bắt buộc)</p>
          <Input aria-label="Tên nhà tài trợ" maxLength={80} value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} placeholder="VD: Cửa hàng giày ABC" />
          {sponsorName.trim() && scope === 'CLUB' && (
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border p-2 text-sm">
              {/* eslint-disable-next-line @next/next/no-img-element -- xem trước logo vừa tải */}
              {sponsorLogo ? <img src={sponsorLogo} alt="" className="h-10 max-w-24 object-contain" /> : <ImagePlus className="size-5 text-fg-muted" aria-hidden />}
              <span className="text-fg-muted">{uploading ? 'Đang tải…' : sponsorLogo ? 'Đổi logo' : 'Tải logo (hiện trên màn hình quay)'}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void pickLogo(e.target.files?.[0])} />
            </label>
          )}
        </div>
        {rule !== 'MANUAL' && <SwitchRow checked={exclude} onChange={setExclude} label="Loại người đã trúng ở lượt trước" description="Mỗi người trúng tối đa một lần trong cùng chương trình" />}
      </div>
    </Sheet>
  )
}

/** Tích chọn người: tìm không dấu, chọn tất cả / bỏ chọn, lọc người đã hoàn thành */
function PeoplePicker({ title, hint, people, loading, value, onChange, onClose }: {
  title: string; hint: string; people: DrawCandidate[]; loading: boolean; value: Set<string>; onChange: (s: Set<string>) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [onlyDone, setOnlyDone] = useState(false)
  const list = filterSearch(people.filter((p) => !onlyDone || p.completed), q, (p) => [p.name])
  const toggle = (id: string) => { const s = new Set(value); if (s.has(id)) s.delete(id); else s.add(id); onChange(s) }
  const all = () => { const s = new Set(value); list.forEach((p) => s.add(p.user_id)); onChange(s) }
  const none = () => { const s = new Set(value); list.forEach((p) => s.delete(p.user_id)); onChange(s) }
  return (
    <Sheet open onClose={onClose} title={title} description={hint}
      footer={<Button block onClick={onClose}>Xong · {value.size} người</Button>}>
      <div className="space-y-3">
        <Input type="search" placeholder="Tìm tên…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm người" />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button size="sm" variant="secondary" onClick={all}>Chọn {q || onlyDone ? 'kết quả lọc' : 'tất cả'}</Button>
          <Button size="sm" variant="ghost" onClick={none}>Bỏ chọn</Button>
          {people.some((p) => p.completed) && (
            <label className="ml-auto flex items-center gap-1.5 text-xs text-fg-muted">
              <input type="checkbox" checked={onlyDone} onChange={(e) => setOnlyDone(e.target.checked)} className="size-4 accent-[var(--color-brand)]" />Chỉ người hoàn thành
            </label>
          )}
        </div>
        {loading ? <Skeleton className="h-40" /> : !list.length ? <p className="py-6 text-center text-sm text-fg-muted">Không có ai.</p> : (
          <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto">
            {list.map((p) => (
              <li key={p.user_id}>
                <label className="flex min-h-12 cursor-pointer items-center gap-3 py-1.5">
                  <input type="checkbox" checked={value.has(p.user_id)} onChange={() => toggle(p.user_id)} className="size-5 shrink-0 accent-[var(--color-brand)]" />
                  <Avatar src={p.avatar_url} name={p.name} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                  {p.completed && <span className="shrink-0 text-[11px] font-semibold text-brand">Hoàn thành</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  )
}
