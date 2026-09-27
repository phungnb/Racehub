'use client'

import { useState } from 'react'
import { ChevronRight, History, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ConfirmSheet, ErrorState, Field, Input, SegmentedControl, Skeleton, SwitchRow, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import {
  ANTI_CHEAT_LIMITS, DEFAULT_ANTI_CHEAT, FEATURES, TRACKING_LIMITS, validateOps,
  type AntiCheatRules, type EnterpriseContent, type FeatureKey, type OpsPolicy, type TrackingRules,
} from '@/shared/lib/ops'
import { useConfigHistory, useOpsPolicy, usePublishOps, useRollbackConfig } from '@/features/system'
import { consoleErrorMessage } from '../../api/consoleApi'

/** Bản đồ mọi chính sách admin tự đổi được — không phải sửa code */
const MAP: { tab: string; title: string; text: string }[] = [
  { tab: 'policy', title: 'Kinh tế Xu & thưởng', text: 'Xu mỗi km, trần / ngày, thưởng lên cấp, giới thiệu bạn, chào mừng trở lại, phí tạo thử thách, hạn mức CLB miễn phí (thành viên, quản trị viên, thử thách)' },
  { tab: 'plans', title: 'Gói & giá', text: 'Thẻ gói Miễn phí / CLB Miễn phí / Doanh nghiệp, giá VIP / CLB Pro theo kỳ hạn, quyền lợi, lượt tạo thử thách kèm gói' },
  { tab: 'promos', title: 'Khuyến mãi', text: 'Giảm giá gói, mã khuyến mãi, tặng Xu theo nhóm' },
  { tab: 'quests', title: 'Nhiệm vụ', text: 'Nhiệm vụ ngày / tuần / tháng / sự kiện và phần thưởng' },
  { tab: 'gifts', title: 'Quà tặng', text: 'Danh mục quà, giá Xu' },
  { tab: 'help', title: 'Trang menu & pháp lý', text: 'Hướng dẫn, Điều khoản, Quyền riêng tư, Gói & quyền lợi, Doanh nghiệp, thông tin pháp nhân' },
  { tab: 'content', title: 'Kiến thức Runner', text: 'Bài viết, chuyên mục, duyệt bài' },
  { tab: 'strava', title: 'Chia sẻ bài Strava', text: 'Chính sách hiển thị bài từ Strava cho người khác' },
  { tab: 'system', title: 'Thông báo toàn hệ thống', text: 'Băng thông báo bảo trì / sự cố cho mọi người dùng' },
  { tab: 'enterprise', title: 'Doanh nghiệp', text: 'Tạo tổ chức, số chỗ, thời hạn, tổ chức demo' },
]

const TRACK_LABEL: Record<keyof TrackingRules, [string, string, string]> = {
  autoPauseAfterS: ['Tự tạm dừng khi đứng yên', 'giây', 'Đồng hồ chạy đứng lại sau bấy nhiêu giây không di chuyển'],
  longStopAskMin: ['Hỏi "Kết thúc?" khi đứng yên', 'phút', 'Giọng nói + rung + băng thông báo'],
  longStopAutoStopMin: ['Tự chuyển sang Tạm dừng', 'phút', 'Tổng thời gian ngừng tăng; phải lớn hơn mốc hỏi'],
  trimTailMin: ['Bỏ đứng yên cuối bài khi Kết thúc', 'phút', 'Đứng yên từ bấy nhiêu phút ở cuối thì giờ kết thúc = lúc dừng chạy'],
}
const AC_LABEL: Record<keyof AntiCheatRules, [string, string]> = {
  dailyRunLimit: ['Số bài tối đa / ngày', 'bài'], minPaceMin: ['Pace trung bình nhanh nhất hợp lệ', 'phút/km'],
  vehicleKmh: ['Tốc độ "đi xe"', 'km/h'], vehicleS: ['…liên tục', 'giây'],
  severeKmh: ['Giữ tốc độ nghiêm trọng', 'km/h'], severeS: ['…liên tục', 'giây'],
  highKmh: ['Giữ tốc độ cao', 'km/h'], highS: ['…liên tục', 'giây'],
  spikeKmh: ['Nhảy điểm GPS nhanh hơn', 'km/h'], spikeMax: ['…quá số lần', 'lần'],
}

function NumField({ id, label, unit, hint, value, onChange, limits }: {
  id: string; label: string; unit: string; hint?: string; value: number; onChange: (v: number) => void; limits: [number, number]
}) {
  const [text, setText] = useState(String(value).replace('.', ','))
  const bad = !(value >= limits[0] && value <= limits[1])
  return (
    <Field label={label} htmlFor={id} hint={`${hint ? `${hint} · ` : ''}${limits[0]}–${limits[1]} ${unit}`} error={bad ? `Từ ${limits[0]} đến ${limits[1]} ${unit}` : null}>
      <div className="relative">
        <Input id={id} inputMode="decimal" className="pr-20 font-mono" value={text}
          onChange={(e) => { setText(e.target.value); const v = Number(e.target.value.replace(',', '.')); if (e.target.value.trim() && !Number.isNaN(v)) onChange(v) }} />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg-subtle">{unit}</span>
      </div>
    </Field>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="space-y-3">
      <div><h2 className="font-semibold">{title}</h2>{hint && <p className="text-xs text-fg-subtle">{hint}</p>}</div>
      {children}
    </Card>
  )
}

/**
 * Quản trị → Hệ thống → Chính sách vận hành: bản đồ mọi chính sách + form bật / tắt tính năng, ghi bài chạy,
 * ngưỡng chống gian lận, nội dung trang Doanh nghiệp. Mỗi lần lưu = một phiên bản (lịch sử, khôi phục, nhật ký quản trị).
 */
export function OpsPolicyTab({ onGo }: { onGo: (tab: string) => void }) {
  const current = useOpsPolicy()
  // Chờ đọc được bản có ngưỡng chống gian lận (chỉ admin nhận) rồi mới dựng form, để không ghi đè bằng mặc định
  if (!current.antiCheat && current.version !== 0) return <Skeleton className="h-96" />
  return <Editor key={current.version} current={current} onGo={onGo} />
}

function Editor({ current, onGo }: { current: OpsPolicy; onGo: (tab: string) => void }) {
  const [features, setFeatures] = useState(current.features)
  const [tracking, setTracking] = useState(current.tracking)
  const [anti, setAnti] = useState<AntiCheatRules>(current.antiCheat ?? DEFAULT_ANTI_CHEAT)
  const [ent, setEnt] = useState<EnterpriseContent>(current.content.enterprise)
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)
  const publish = usePublishOps()
  const error = validateOps({ tracking, antiCheat: anti, content: { enterprise: ent } })
  const changed = JSON.stringify({ features, tracking, anti, ent }) !== JSON.stringify({ features: current.features, tracking: current.tracking, anti: current.antiCheat ?? DEFAULT_ANTI_CHEAT, ent: current.content.enterprise })
  const off = FEATURES.filter((f) => !features[f.key])
  const save = () => publish.mutate({ p: { features, tracking, antiCheat: anti, content: { enterprise: ent } }, note }, {
    onSuccess: (v) => { toast.success(`Đã áp dụng chính sách vận hành bản v${v}`); setConfirm(false); setNote('') },
    onError: (e) => toast.error(consoleErrorMessage(e)),
  })
  const setF = (i: number, patch: Partial<EnterpriseContent['features'][number]>) =>
    setEnt((x) => ({ ...x, features: x.features.map((f, j) => (j === i ? { ...f, ...patch } : f)) }))

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <h2 className="font-semibold">Bản đồ chính sách</h2>
        <p className="text-xs text-fg-subtle">Mọi quy tắc dưới đây admin tự đổi khi hệ thống đang chạy — có kiểm tra giới hạn, lưu phiên bản và ghi nhật ký quản trị. Không cần sửa code hay dựng lại app.</p>
        <ul className="divide-y divide-border">
          {MAP.map((m) => (
            <li key={m.tab}>
              <button type="button" onClick={() => onGo(m.tab)} className="flex w-full items-center gap-3 py-2 text-left">
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{m.title}</span><span className="block text-xs text-fg-muted">{m.text}</span></span>
                <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <p className="px-1 text-xs text-fg-muted">Đang áp dụng: <b className="text-fg">bản v{current.version}</b>{current.version === 0 ? ' (mặc định của hệ thống)' : ''}.</p>

      <Section title="Bật / tắt tính năng" hint="Tắt: người dùng không thấy lối vào, mở link thì báo tạm dừng. Admin vẫn vào được để kiểm tra.">
        {FEATURES.map((f) => (
          <SwitchRow key={f.key} checked={features[f.key]} label={f.label} description={f.hint}
            onChange={(v) => setFeatures((x) => ({ ...x, [f.key as FeatureKey]: v }))} />
        ))}
      </Section>

      <Section title="Ghi bài chạy" hint="Áp dụng cho bài bắt đầu sau khi lưu (app đọc lại chính sách mỗi 10 phút).">
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(TRACK_LABEL) as (keyof TrackingRules)[]).map((k) => (
            <NumField key={k} id={`trk-${k}`} label={TRACK_LABEL[k][0]} unit={TRACK_LABEL[k][1]} hint={TRACK_LABEL[k][2]}
              value={tracking[k]} limits={TRACKING_LIMITS[k]} onChange={(v) => setTracking((x) => ({ ...x, [k]: v }))} />
          ))}
        </div>
      </Section>

      <Section title="Ngưỡng chống gian lận" hint="Chỉ áp khi người chạy đang tham gia thử thách / giải / chiến dịch; bài vượt ngưỡng chờ duyệt. Dùng chung cho bài ghi bằng app và bài từ Strava. Người dùng không xem được các số này.">
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(AC_LABEL) as (keyof AntiCheatRules)[]).map((k) => (
            <NumField key={k} id={`ac-${k}`} label={AC_LABEL[k][0]} unit={AC_LABEL[k][1]} value={anti[k]} limits={ANTI_CHEAT_LIMITS[k]}
              onChange={(v) => setAnti((x) => ({ ...x, [k]: v }))} />
          ))}
        </div>
      </Section>

      <Section title="Trang Doanh nghiệp" hint="Tiêu đề, mô tả và các thẻ tính năng của trang /doanh-nghiep. Giá và hạn mức gói tự lấy từ Gói & giá / Kinh tế.">
        <Field label="Tiêu đề" htmlFor="ent-title"><Input id="ent-title" maxLength={90} value={ent.title} onChange={(e) => setEnt((x) => ({ ...x, title: e.target.value }))} /></Field>
        <Field label="Mô tả" htmlFor="ent-sub"><Textarea id="ent-sub" rows={2} maxLength={400} value={ent.subtitle} onChange={(e) => setEnt((x) => ({ ...x, subtitle: e.target.value }))} /></Field>
        <ul className="space-y-2">
          {ent.features.map((f, i) => (
            <li key={i} className="space-y-1.5 rounded-xl border border-border p-2">
              <div className="flex gap-2">
                <Input aria-label={`Tiêu đề thẻ ${i + 1}`} maxLength={60} value={f.title} onChange={(e) => setF(i, { title: e.target.value })} />
                <Button size="sm" variant="ghost" aria-label="Xoá thẻ" disabled={ent.features.length <= 1}
                  onClick={() => setEnt((x) => ({ ...x, features: x.features.filter((_, j) => j !== i) }))}><Trash2 className="size-4" aria-hidden /></Button>
              </div>
              <Textarea aria-label={`Nội dung thẻ ${i + 1}`} rows={2} maxLength={300} value={f.text} onChange={(e) => setF(i, { text: e.target.value })} />
            </li>
          ))}
        </ul>
        {ent.features.length < 12 && (
          <Button size="sm" variant="secondary" onClick={() => setEnt((x) => ({ ...x, features: [...x.features, { title: 'Tính năng mới', text: '' }] }))}>
            <Plus className="size-4" aria-hidden />Thêm thẻ
          </Button>
        )}
      </Section>

      <div className="sticky bottom-20 z-10 space-y-2 rounded-2xl border border-border bg-bg/95 p-3 backdrop-blur">
        {error ? <p role="alert" className="text-xs text-danger">{error}</p>
          : <p className="text-xs text-fg-muted">{changed ? 'Có thay đổi chưa lưu.' : 'Chưa có thay đổi.'}</p>}
        <Button block disabled={!changed || !!error} onClick={() => setConfirm(true)}>Lưu & áp dụng</Button>
      </div>

      <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} danger={false} loading={publish.isPending} confirmLabel="Áp dụng ngay"
        title="Áp dụng chính sách vận hành mới?" onConfirm={save}>
        <div className="space-y-3 text-sm">
          {off.length > 0 && <p className="rounded-lg bg-warning/10 px-3 py-2 text-warning">Sẽ TẮT với người dùng: {off.map((f) => f.label).join(', ')}.</p>}
          <p className="text-fg-muted">Mọi người dùng nhận chính sách mới trong vài phút. Có thể khôi phục bản cũ bất cứ lúc nào ở mục Lịch sử.</p>
          <Field label="Ghi chú thay đổi (vào nhật ký quản trị)" htmlFor="ops-note">
            <Input id="ops-note" maxLength={160} placeholder="vd. Tạm tắt Chợ BIB để rà soát" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </ConfirmSheet>

      <HistoryCard />
    </div>
  )
}

/** Lịch sử phiên bản + khôi phục (chính sách vận hành và chính sách kinh tế) */
function HistoryCard() {
  const [key, setKey] = useState<'ops_policy' | 'economy_global_config'>('ops_policy')
  const [open, setOpen] = useState(false)
  const q = useConfigHistory(key, open)
  const rb = useRollbackConfig()
  const [target, setTarget] = useState<number | null>(null)
  return (
    <Card className="space-y-3">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
        <History className="size-4 text-fg-muted" aria-hidden /><span className="flex-1 font-semibold">Lịch sử & khôi phục</span>
        <ChevronRight className={cn('size-4 text-fg-subtle transition-transform', open && 'rotate-90')} aria-hidden />
      </button>
      {open && (
        <>
          <SegmentedControl value={key} onChange={(v) => setKey(v as typeof key)}
            options={[{ value: 'ops_policy', label: 'Vận hành' }, { value: 'economy_global_config', label: 'Kinh tế' }]} />
          {q.isPending ? <Skeleton className="h-24" /> : q.isError ? <ErrorState message={consoleErrorMessage(q.error, 'Chưa đọc được lịch sử (cần migration 009100).')} error={q.error} onRetry={() => void q.refetch()} />
            : !q.data.length ? <p className="text-sm text-fg-muted">Chưa có phiên bản nào — đang dùng mặc định.</p> : (
              <ul className="divide-y divide-border">
                {q.data.map((v) => (
                  <li key={v.version} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1 text-sm">
                      <b>v{v.version}</b> {v.status === 'PUBLISHED' && <span className="ml-1 rounded bg-brand/15 px-1.5 text-[11px] font-semibold text-brand">Đang dùng</span>}
                      <span className="block text-xs text-fg-muted">{new Date(v.created_at).toLocaleString('vi-VN')} · {v.by}</span>
                    </span>
                    {v.status !== 'PUBLISHED' && (
                      <Button size="sm" variant="secondary" onClick={() => setTarget(v.version)}><RotateCcw className="size-4" aria-hidden />Khôi phục</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
        </>
      )}
      <ConfirmSheet open={target !== null} onClose={() => setTarget(null)} danger={false} loading={rb.isPending} confirmLabel="Khôi phục"
        title={`Khôi phục bản v${target ?? ''}?`}
        description="Nội dung bản cũ được xuất bản lại thành phiên bản mới (qua đúng bước kiểm tra), ghi nhật ký quản trị."
        onConfirm={() => target !== null && rb.mutate({ key, version: target }, {
          onSuccess: (v) => { toast.success(`Đã khôi phục — đang dùng bản v${v}`); setTarget(null) },
          onError: (e) => toast.error(consoleErrorMessage(e)),
        })} />
    </Card>
  )
}
