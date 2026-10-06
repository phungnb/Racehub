'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Input, Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { challengeErrorMessage, getConquestBoard, saveHonor, type Challenge, type HonorState, type LeaderboardEntry } from '../../api/challengeApi'
import { challengeKeys } from '../../hooks/useChallenge'
import { isConquest } from '../../model/challenge'
import { goalHonors, HONOR_DISTANCES, HONOR_KINDS, MAX_CATEGORIES, type HonorCategory, type HonorKind } from '../../model/honor'

type BaseKind = keyof typeof HONOR_KINDS
const COUNTS = [1, 3, 5, 10]

/** BTC chọn hạng mục vinh danh: hạng mục tính tự động + giải tự đặt (chọn tay người nhận) */
export function HonorSetup({ challenge, honor, participants, onClose }: {
  challenge: Challenge; honor: HonorState; participants: LeaderboardEntry[]; onClose: () => void
}) {
  const challengeId = challenge.id
  const qc = useQueryClient()
  // 013300: vinh danh theo từng mục tiêu BTC đặt (mốc km tự đăng ký / hạng mục chinh phục)
  const conquest = useQuery({ queryKey: challengeKeys.conquest(challengeId), queryFn: () => getConquestBoard(challengeId), enabled: isConquest(challenge.objective) })
  const goals = goalHonors(challenge, conquest.data?.categories ?? [])
  const [enabled, setEnabled] = useState(honor.categories.length ? honor.enabled : true)
  const [cats, setCats] = useState<HonorCategory[]>(() => honor.categories.length ? honor.categories
    : [{ key: 'TOP', title: HONOR_KINDS.TOP.title, count: 3 }, { key: 'DAYS', title: HONOR_KINDS.DAYS.title, count: 1 }])
  const [pick, setPick] = useState<HonorKind | null>(null)
  const has = (k: string) => cats.some((c) => c.key === k)
  const patch = (k: string, p: Partial<HonorCategory>) => setCats((cs) => cs.map((c) => (c.key === k ? { ...c, ...p } : c)))
  const toggle = (k: BaseKind) => setCats((cs) => has(k) ? cs.filter((c) => c.key !== k)
    : cs.length >= MAX_CATEGORIES ? cs : [...cs, { key: k, title: HONOR_KINDS[k].title, count: k === 'TOP' ? 3 : 1 }])
  const toggleDist = (k: HonorKind, title: string) => setCats((cs) => has(k) ? cs.filter((c) => c.key !== k)
    : cs.length >= MAX_CATEGORIES ? cs : [...cs, { key: k, title, count: 3 }])
  const customs = cats.filter((c) => c.key.startsWith('CUSTOM'))
  const addCustom = () => {
    const free = [1, 2, 3, 4, 5].map((i) => `CUSTOM${i}` as HonorKind).find((k) => !has(k))
    if (!free || cats.length >= MAX_CATEGORIES) return
    setCats((cs) => [...cs, { key: free, title: 'Giải của Ban tổ chức', count: 1, users: [] }])
    setPick(free)
  }
  const save = useMutation({
    mutationFn: () => saveHonor(challengeId, { enabled, categories: cats, design: honor.design, card_design: honor.card_design }),
    onSuccess: (r) => { qc.setQueryData(['challenge', challengeId, 'honor'], r); toast.success('Đã lưu hạng mục vinh danh'); onClose() },
    onError: (e) => toast.error(challengeErrorMessage(e)),
  })
  const picking = cats.find((c) => c.key === pick)

  return (
    <Sheet open onClose={onClose} title="Hạng mục vinh danh" description={`Tối đa ${MAX_CATEGORIES} hạng mục. Danh sách tự tính từ kết quả thử thách; công bố sau khi kết thúc 24 giờ.`}
      footer={<Button block onClick={() => save.mutate()} loading={save.isPending}>Lưu</Button>}>
      <div className="space-y-4">
        <label className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-5 accent-[var(--color-brand)]" />
          Bật mục Vinh danh cho thử thách này
        </label>
        <div className="space-y-2">
          {(Object.keys(HONOR_KINDS) as BaseKind[]).map((k) => {
            const c = cats.find((x) => x.key === k)
            return (
              <div key={k} className={cn('space-y-2 rounded-xl border p-3', c ? 'border-brand/60 bg-brand/5' : 'border-border')}>
                <label className="flex items-start gap-3">
                  <input type="checkbox" checked={!!c} onChange={() => toggle(k)} className="mt-0.5 size-5 accent-[var(--color-brand)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{HONOR_KINDS[k].title}</span>
                    <span className="block text-[11px] text-fg-muted">{HONOR_KINDS[k].hint}</span>
                  </span>
                </label>
                {c && <CategoryFields c={c} onChange={(p) => patch(k, p)} />}
              </div>
            )
          })}
        </div>
        {goals.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Theo mục tiêu thành viên chọn</p>
            <p className="text-[11px] text-fg-muted">
              {isConquest(challenge.objective) ? 'Mỗi hạng mục một bảng riêng: người đạt mục tiêu hạng mục, kết quả nhanh nhất trước.'
                : 'Mỗi mục tiêu một bảng riêng: chỉ người chọn mục tiêu đó và đã hoàn thành, nhiều km được tính hơn đứng trước.'}
            </p>
            {goals.map((x) => {
              const c = cats.find((y) => y.key === x.key)
              return (
                <div key={x.key} className={cn('space-y-2 rounded-xl border p-3', c ? 'border-brand/60 bg-brand/5' : 'border-border')}>
                  <label className="flex items-center gap-3">
                    <input type="checkbox" checked={!!c} onChange={() => toggleDist(x.key, x.title)} className="size-5 accent-[var(--color-brand)]" />
                    <span className="text-sm font-semibold">{x.label}</span>
                  </label>
                  {c && <CategoryFields c={c} onChange={(p) => patch(x.key, p)} />}
                </div>
              )
            })}
          </div>
        )}
        <div className="space-y-2">
          <p className="text-sm font-semibold">Theo cự ly</p>
          <p className="text-[11px] text-fg-muted">Bài chạy nhanh nhất có cự ly ≥ hạng mục trong thời gian thử thách; thời gian quy đổi theo pace trung bình (VD bài 21,3 km trong 1:52:00 tính cho 21 km là 1:50:56).</p>
          {HONOR_DISTANCES.map((x) => {
            const c = cats.find((y) => y.key === x.key)
            return (
              <div key={x.key} className={cn('space-y-2 rounded-xl border p-3', c ? 'border-brand/60 bg-brand/5' : 'border-border')}>
                <label className="flex items-center gap-3">
                  <input type="checkbox" checked={!!c} onChange={() => toggleDist(x.key, x.title)} className="size-5 accent-[var(--color-brand)]" />
                  <span className="text-sm font-semibold">{x.km}</span>
                </label>
                {c && <CategoryFields c={c} onChange={(p) => patch(x.key, p)} />}
              </div>
            )
          })}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold">Giải do Ban tổ chức tự đặt</p>
          {customs.map((c) => (
            <div key={c.key} className="space-y-2 rounded-xl border border-brand/60 bg-brand/5 p-3">
              <div className="flex items-center gap-2">
                <Input value={c.title} maxLength={60} onChange={(e) => patch(c.key, { title: e.target.value })} aria-label="Tên giải" placeholder="VD: Tinh thần thép" />
                <Button variant="ghost" className="w-10 shrink-0 px-0" aria-label="Bỏ giải" onClick={() => setCats((cs) => cs.filter((x) => x.key !== c.key))}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
              <button type="button" onClick={() => setPick(c.key)} className="w-full rounded-lg border border-dashed border-border px-3 py-2 text-left text-xs text-fg-muted">
                {(c.users ?? []).length ? `Đã chọn ${(c.users ?? []).length} người — chạm để sửa` : 'Chọn người nhận giải (tối đa 10)'}
              </button>
            </div>
          ))}
          {customs.length < 5 && cats.length < MAX_CATEGORIES && (
            <Button size="sm" variant="secondary" onClick={addCustom}><Plus className="size-4" aria-hidden />Thêm giải tự đặt</Button>
          )}
        </div>
      </div>

      {picking && (
        <Sheet open onClose={() => setPick(null)} title={`Người nhận: ${picking.title}`} description="Chọn theo thứ tự muốn hiển thị (tối đa 10)."
          footer={<Button block onClick={() => setPick(null)}>Xong</Button>}>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {participants.map((p) => {
              const sel = (picking.users ?? []).indexOf(p.user_id)
              return (
                <li key={p.user_id}>
                  <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left"
                    onClick={() => patch(picking.key, { users: sel >= 0 ? (picking.users ?? []).filter((u) => u !== p.user_id)
                      : (picking.users ?? []).length >= 10 ? picking.users : [...(picking.users ?? []), p.user_id] })}>
                    <span className={cn('grid size-6 shrink-0 place-items-center rounded-full border text-xs font-bold', sel >= 0 ? 'border-brand bg-brand text-brand-fg' : 'border-border')}>
                      {sel >= 0 ? sel + 1 : ''}
                    </span>
                    <Avatar src={p.avatar_url} name={p.display_name} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm">{p.display_name}</span>
                    <span className="text-xs text-fg-muted">#{p.rank}</span>
                  </button>
                </li>
              )
            })}
            {!participants.length && <li className="p-3 text-sm text-fg-muted">Chưa có người tham gia.</li>}
          </ul>
        </Sheet>
      )}
    </Sheet>
  )
}

function CategoryFields({ c, onChange }: { c: HonorCategory; onChange: (p: Partial<HonorCategory>) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pl-8">
      <Input value={c.title} maxLength={60} onChange={(e) => onChange({ title: e.target.value })} aria-label="Tên hiển thị" className="h-9 min-w-40 flex-1 text-sm" />
      <div className="flex shrink-0 gap-1" role="group" aria-label="Số người">
        {COUNTS.map((n) => (
          <button key={n} type="button" aria-pressed={c.count === n} onClick={() => onChange({ count: n })}
            className={cn('h-9 min-w-9 rounded-lg border px-2 text-xs font-semibold', c.count === n ? 'border-brand bg-brand/15' : 'border-border text-fg-muted')}>
            {n === 1 ? 'Top 1' : `Top ${n}`}
          </button>
        ))}
      </div>
    </div>
  )
}
