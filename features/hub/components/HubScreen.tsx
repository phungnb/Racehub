'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Flame, LogOut, MessageSquarePlus, Newspaper, PenLine, Search, ShieldAlert, Trophy, Users, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ConfirmSheet, EmptyState, ErrorState, Input, PageHeader, ScrollRow, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { PROVINCES } from '@/shared/lib/provinces'
import { routes } from '@/shared/config/routes'
import { GOALS, PACE_FILTERS, setDiscovery, type Goal } from '@/features/nearby'
import { hubErrorMessage, type FeedFilters, type HubFilters, type MyHub, type PostKind } from '../api/hubApi'
import { POST_KINDS } from '../model/hub'
import { useHubFeed, useHubMutation, useHubRunners, useMyHub } from './hubHooks'
import { HubPostCard } from './HubPostCard'
import { HubRunnerCard, PrRow, StatsLine } from './HubRunnerCard'
import { JoinHubSheet, NewPostSheet } from './HubSheets'

type Tab = 'feed' | 'runners' | 'me'

/**
 * Hội quán runner: runner mọi miền tự tham gia — hồ sơ + thành tích ước tính, bảng tin (rủ chạy, đi giải cùng, pacer,
 * khoe thành tích, hỏi đáp), danh bạ runner có điểm hợp nhau. Xem docs/QUANH_DAY_HOI_QUAN.md.
 */
export function HubScreen() {
  const me = useMyHub()
  return (
    <div className="space-y-4">
      <PageHeader title="Hội quán runner" subtitle="Runner khắp Việt Nam · khoe thành tích · rủ chạy · đi giải cùng" fallback={routes.nearby} />
      {me.isPending ? <div className="space-y-3"><Skeleton className="h-32" /><Skeleton className="h-40" /></div>
        : me.isError ? <ErrorState message={hubErrorMessage(me.error)} error={me.error} onRetry={() => void me.refetch()} />
        : <Body me={me.data} />}
    </div>
  )
}

function Body({ me }: { me: MyHub }) {
  const postId = useSearchParams().get('post')
  const [tab, setTab] = useState<Tab>('feed')
  const [sheet, setSheet] = useState<'join' | 'post' | null>(null)
  if (me.suspended) {
    return <EmptyState icon={ShieldAlert} title="Hội quán đang tạm khoá với bạn" description="Tài khoản nhận nhiều báo cáo, chờ quản trị viên xem xét. Các tính năng khác vẫn dùng bình thường." />
  }
  return (
    <>
      {!me.listed && <JoinCard me={me} onJoin={() => setSheet('join')} />}
      {postId && <FocusPost id={postId} />}
      <SegmentedControl value={tab} onChange={setTab} options={[
        { value: 'feed', label: 'Bảng tin' }, { value: 'runners', label: 'Runner' }, { value: 'me', label: 'Hồ sơ của tôi' },
      ]} />
      {tab === 'feed' && <Feed me={me} onPost={() => setSheet(me.listed ? 'post' : 'join')} />}
      {tab === 'runners' && <Runners me={me} />}
      {tab === 'me' && <MyProfile me={me} onEdit={() => setSheet('join')} onPost={() => setSheet(me.listed ? 'post' : 'join')} />}
      {sheet === 'join' && <JoinHubSheet me={me} onClose={() => setSheet(null)} />}
      {sheet === 'post' && <NewPostSheet me={me} onClose={() => setSheet(null)} />}
    </>
  )
}

function JoinCard({ me, onJoin }: { me: MyHub; onJoin: () => void }) {
  return (
    <Card className="space-y-3 bg-gradient-to-br from-violet-500/20 to-transparent">
      <div className="flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-violet-500/25 text-violet-200"><UsersRound className="size-6" aria-hidden /></span>
        <div>
          <p className="font-semibold">Gặp runner khắp mọi miền</p>
          <p className="text-sm text-fg-muted">Tạo hồ sơ chạy bộ — thành tích tự tính từ bài chạy của bạn. Tìm bạn hợp pace, rủ đi giải, tìm pacer, khoe PR mới.</p>
        </div>
      </div>
      <ul className="grid grid-cols-3 gap-2 text-center text-[11px] text-fg-muted">
        <li className="rounded-xl bg-surface-2 p-2"><Trophy className="mx-auto mb-1 size-4 text-coin" aria-hidden />Thành tích 5K–Full</li>
        <li className="rounded-xl bg-surface-2 p-2"><Users className="mx-auto mb-1 size-4 text-brand" aria-hidden />Ghép bạn hợp pace</li>
        <li className="rounded-xl bg-surface-2 p-2"><Flame className="mx-auto mb-1 size-4 text-live" aria-hidden />Rủ chạy, đi giải</li>
      </ul>
      <Button block onClick={onJoin}>{me.eligible ? 'Tham gia Hội quán' : `Cần 3 bài chạy hợp lệ (có ${me.valid_runs})`}</Button>
    </Card>
  )
}

/** Mở từ thông báo: /hub?post=<id> */
function FocusPost({ id }: { id: string }) {
  const q = useHubFeed({ id })
  const p = q.data?.pages[0]?.items[0]
  if (q.isPending) return <Skeleton className="h-36" />
  if (!p) return <p className="rounded-xl bg-surface-2 p-3 text-sm text-fg-muted">Bài đăng không còn (đã đóng hoặc hết hạn).</p>
  return <HubPostCard p={p} highlight />
}

function Feed({ me, onPost }: { me: MyHub; onPost: () => void }) {
  const [kind, setKind] = useState<PostKind | 'ALL'>('ALL')
  const [province, setProvince] = useState('')
  const [near, setNear] = useState(false)
  const f: FeedFilters = { kind, province: province || undefined, scope: near ? 'NEAR' : 'ALL' }
  const q = useHubFeed(f)
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <div className="space-y-3">
      <Button block onClick={onPost}><MessageSquarePlus className="size-4" aria-hidden />{me.listed ? 'Đăng bài: rủ chạy, đi giải, khoe PR…' : 'Tham gia để đăng bài'}</Button>
      <ScrollRow className="-mx-4" innerClassName="gap-1.5 px-4 pb-1">
        <Pill on={kind === 'ALL'} onClick={() => setKind('ALL')}>Tất cả</Pill>
        {(Object.keys(POST_KINDS) as PostKind[]).map((k) => <Pill key={k} on={kind === k} onClick={() => setKind(k)}>{POST_KINDS[k].emoji} {POST_KINDS[k].label}</Pill>)}
      </ScrollRow>
      <div className="flex gap-2">
        <ProvinceSelect value={province} onChange={setProvince} />
        {me.located && <Pill on={near} onClick={() => setNear(!near)}>📍 Gần tôi</Pill>}
      </div>
      {q.isPending ? <div className="space-y-3"><Skeleton className="h-36" /><Skeleton className="h-36" /></div>
        : q.isError ? <ErrorState message={hubErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : items.length === 0 ? <EmptyState icon={Newspaper} title="Chưa có bài phù hợp" description="Hãy là người mở hàng — rủ một buổi chạy hoặc khoe PR gần nhất của bạn!" />
        : (
          <>
            {items.map((p) => <HubPostCard key={p.id} p={p} />)}
            {q.hasNextPage && <Button block variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Xem thêm</Button>}
          </>
        )}
    </div>
  )
}

function Runners({ me }: { me: MyHub }) {
  const [text, setText] = useState('')
  const [qText, setQText] = useState('')
  const [province, setProvince] = useState('')
  const [goal, setGoal] = useState<Goal | 'ALL'>('ALL')
  const [pace, setPace] = useState<NonNullable<HubFilters['pace']>>('ALL')
  const [sort, setSort] = useState<NonNullable<HubFilters['sort']>>('MATCH')
  // Gõ tên: chờ dừng gõ 300 ms mới tìm
  useEffect(() => { const t = setTimeout(() => setQText(text.trim()), 300); return () => clearTimeout(t) }, [text])
  const q = useHubRunners({ q: qText || undefined, province: province || undefined, goal, pace, sort })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  const total = q.data?.pages[0]?.total ?? 0
  const paceOptions = { ALL: PACE_FILTERS.ALL, FAST: PACE_FILTERS.FAST, MID: PACE_FILTERS.MID, EASY: PACE_FILTERS.EASY }
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tìm tên runner, giới thiệu…" className="pl-9" aria-label="Tìm runner" enterKeyHint="search" />
      </div>
      <ScrollRow className="-mx-4" innerClassName="gap-1.5 px-4 pb-1">
        <ProvinceSelect value={province} onChange={setProvince} />
        <select aria-label="Mục tiêu" value={goal} onChange={(e) => setGoal(e.target.value as Goal | 'ALL')} className={selectCls(goal !== 'ALL')}>
          <option value="ALL">Mọi mục tiêu</option>
          {(Object.keys(GOALS) as Goal[]).map((g) => <option key={g} value={g}>{GOALS[g]}</option>)}
        </select>
        <select aria-label="Pace" value={pace} onChange={(e) => setPace(e.target.value as typeof pace)} className={selectCls(pace !== 'ALL')}>
          {Object.entries(paceOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </ScrollRow>
      <SegmentedControl value={sort} onChange={setSort} options={[
        { value: 'MATCH', label: 'Hợp với tôi' }, { value: 'ACTIVE', label: 'Mới chạy' }, { value: 'NEW', label: 'Mới tham gia' },
      ]} />
      {q.isPending ? <div className="space-y-3"><Skeleton className="h-52" /><Skeleton className="h-52" /></div>
        : q.isError ? <ErrorState message={hubErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : items.length === 0 ? <EmptyState icon={Users} title="Chưa có runner khớp" description="Thử bỏ bớt bộ lọc, hoặc mời bạn chạy cùng tham gia Hội quán." />
        : (
          <>
            <p className="text-xs text-fg-muted">{total} runner{me.listed ? ' · xếp theo mức hợp với bạn (pace, tỉnh, mục tiêu, khung giờ)' : ''} · thành tích ước tính từ bài đã chia sẻ</p>
            {items.map((r) => <HubRunnerCard key={r.id} r={r} />)}
            {q.hasNextPage && <Button block variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Xem thêm</Button>}
          </>
        )}
    </div>
  )
}

function MyProfile({ me, onEdit, onPost }: { me: MyHub; onEdit: () => void; onPost: () => void }) {
  const [leave, setLeave] = useState(false)
  const out = useHubMutation(() => setDiscovery({ hub_listed: false }))
  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold">{me.listed ? 'Hồ sơ đang hiện trong Hội quán' : 'Xem trước hồ sơ của bạn'}</p>
            <p className="truncate text-sm text-fg-muted">{[me.province, me.headline].filter(Boolean).join(' · ') || 'Chưa có tỉnh / giới thiệu'}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={onEdit}><PenLine className="size-4" aria-hidden />{me.listed ? 'Sửa' : 'Tạo hồ sơ'}</Button>
        </div>
        <PrRow prs={me.prs} />
        <StatsLine s={me.stats} pace={me.share_pace ? me.pace_s : null} />
        <p className="text-[11px] text-fg-subtle">Thành tích ước tính 12 tháng: lấy bài dài hơn cự ly, quy pace trung bình về đúng cự ly (luôn chậm hơn hoặc bằng thực tế). Chỉ tính bài hợp lệ bạn đã chia sẻ.</p>
      </Card>
      {me.listed && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Bài của tôi{me.interests_in ? <span className="ml-1.5 text-xs text-brand">{me.interests_in} lượt quan tâm</span> : null}</h2>
            <Button size="sm" variant="ghost" onClick={onPost}><MessageSquarePlus className="size-4" aria-hidden />Đăng bài</Button>
          </div>
          {me.posts.length === 0 ? <p className="text-sm text-fg-muted">Chưa có bài nào trong 60 ngày.</p> : me.posts.map((p) => <HubPostCard key={p.id} p={p} />)}
          <Button block variant="ghost" className="text-danger" onClick={() => setLeave(true)}><LogOut className="size-4" aria-hidden />Rời Hội quán</Button>
        </>
      )}
      <ConfirmSheet open={leave} onClose={() => setLeave(false)} title="Rời Hội quán?" loading={out.isPending} confirmLabel="Rời"
        description="Hồ sơ ẩn ngay, các bài đang mở sẽ đóng. Kết nối và tin nhắn vẫn giữ."
        onConfirm={() => out.mutate(undefined, { onSuccess: () => { toast.success('Đã rời Hội quán'); setLeave(false) }, onError: (e) => toast.error(hubErrorMessage(e)) })} />
    </div>
  )
}

const selectCls = (on: boolean) => cn('h-9 shrink-0 rounded-full border bg-bg px-3 text-xs font-semibold', on ? 'border-brand text-fg' : 'border-border text-fg-muted')

function ProvinceSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select aria-label="Tỉnh / thành" value={value} onChange={(e) => onChange(e.target.value)} className={selectCls(!!value)}>
      <option value="">Toàn quốc</option>
      {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
    </select>
  )
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('h-9 shrink-0 rounded-full border px-3 text-xs font-semibold', on ? 'border-violet-400 bg-violet-500/15 text-fg' : 'border-border text-fg-muted')}>
      {children}
    </button>
  )
}
