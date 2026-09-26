'use client'

import { useDeferredValue, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, CalendarDays, Check, ExternalLink, Images, MoreHorizontal, Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, ConfirmSheet, EmptyState, ErrorState, Field, Input, Sheet, Skeleton, SwitchRow, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { deleteAlbum, listAlbums, openAlbum, reviewAlbum, saveAlbum, type AlbumFilters, type AlbumInput, type ClubAlbum } from '../../api/albumsApi'
import { clubErrorMessage } from '../../api/clubApi'
import { listEvents } from '../../api/eventsApi'
import { postImageUrl, uploadPostImage } from '../../api/postsApi'
import { useClub } from '../../hooks/useClub'
import { clubKeys } from '../../hooks/keys'
import { ALBUM_KINDS, formatDay, isHttpUrl, providerOf, type AlbumKind } from '../../model/media'
import { MenuItem } from '../feed/PostCard'

/** Tab Ảnh: kho link album của CLB (sự kiện, giải, buổi tập) — tìm nhanh, lọc loại / năm; thành viên gửi link, ban chủ nhiệm duyệt */
export function ClubPhotosScreen({ clubId, eventId }: { clubId: string; eventId?: string | null }) {
  const { uid, isStaff } = useClub(clubId)
  const [text, setText] = useState('')
  const q = useDeferredValue(text.trim())
  const [kind, setKind] = useState<AlbumKind | 'ALL'>('ALL')
  const [year, setYear] = useState<number | null>(null)
  const [edit, setEdit] = useState<Partial<ClubAlbum> | null>(null)
  const filters: AlbumFilters = { q, kind, year, event_id: eventId ?? null }
  const list = useInfiniteQuery({
    queryKey: clubKeys.albums(clubId, filters),
    queryFn: ({ pageParam }) => listAlbums(clubId, filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (pages.length * 30 < last.total ? pages.length * 30 : undefined),
    enabled: !!uid,
  })
  const first = list.data?.pages[0]
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const pending = items.filter((a) => a.status === 'PENDING')
  const approved = items.filter((a) => a.status === 'APPROVED')
  if (!uid) return null

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">Kho ảnh CLB</h2>
          <p className="text-sm text-fg-muted">Link album sự kiện, giải chạy, buổi tập — tìm lại ảnh của mình trong vài giây.</p>
        </div>
        <Button size="sm" onClick={() => setEdit({ kind: 'EVENT', event_id: eventId ?? null })}><Plus className="size-4" aria-hidden />{isStaff ? 'Thêm album' : 'Gửi link'}</Button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tìm: tên giải, sự kiện, người chụp… (không cần dấu)" aria-label="Tìm album" className="pl-9" />
      </div>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {(['ALL', ...Object.keys(ALBUM_KINDS)] as (AlbumKind | 'ALL')[]).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
            className={cn('h-9 shrink-0 rounded-full border px-3 text-xs font-semibold', kind === k ? 'border-brand bg-brand/15 text-fg' : 'border-border text-fg-muted')}>
            {k === 'ALL' ? 'Tất cả' : ALBUM_KINDS[k]}
          </button>
        ))}
        {(first?.years.length ?? 0) > 1 && <span className="mx-1 w-px shrink-0 bg-border" aria-hidden />}
        {(first?.years.length ?? 0) > 1 && first!.years.map((y) => (
          <button key={y} type="button" aria-pressed={year === y} onClick={() => setYear(year === y ? null : y)}
            className={cn('h-9 shrink-0 rounded-full border px-3 text-xs font-semibold', year === y ? 'border-brand bg-brand/15 text-fg' : 'border-border text-fg-muted')}>{y}</button>
        ))}
      </div>

      {list.isPending ? <div className="grid grid-cols-2 gap-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="aspect-[4/5]" />)}</div>
        : list.isError ? <ErrorState message={clubErrorMessage(list.error)} error={list.error} onRetry={() => void list.refetch()} />
        : items.length === 0 ? (
          <EmptyState icon={Images} title={q || kind !== 'ALL' || year ? 'Không có album phù hợp' : 'Chưa có album nào'}
            description={q || kind !== 'ALL' || year ? 'Thử từ khoá khác hoặc bỏ bộ lọc.' : 'Dán link album Google Photos, Drive, Facebook… của sự kiện, giải chạy để cả CLB cùng xem.'} />
        ) : (
          <>
            {pending.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-warning">{isStaff ? `Chờ duyệt (${first?.pending ?? pending.length})` : 'Link bạn gửi đang chờ duyệt'}</h3>
                <div className="grid grid-cols-2 gap-3">{pending.map((a) => <AlbumCard key={a.id} a={a} uid={uid} isStaff={isStaff} onEdit={setEdit} />)}</div>
              </section>
            )}
            <div className="grid grid-cols-2 gap-3">{approved.map((a) => <AlbumCard key={a.id} a={a} uid={uid} isStaff={isStaff} onEdit={setEdit} />)}</div>
            {list.hasNextPage && <Button block variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Xem thêm</Button>}
          </>
        )}

      {edit && <AlbumSheet clubId={clubId} uid={uid} isStaff={isStaff} a={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function useRefreshAlbums(clubId: string) {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: ['club', clubId, 'albums'] })
}

function AlbumCard({ a, uid, isStaff, onEdit }: { a: ClubAlbum; uid: string; isStaff: boolean; onEdit: (a: ClubAlbum) => void }) {
  const refresh = useRefreshAlbums(a.club_id)
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const p = providerOf(a.url)
  const mine = a.created_by === uid
  const review = useMutation({ mutationFn: (ok: boolean) => reviewAlbum(a.id, ok), onSuccess: (_, ok) => { toast.success(ok ? 'Đã duyệt album' : 'Đã từ chối'); refresh() }, onError: (e) => toast.error(clubErrorMessage(e)) })
  const del = useMutation({ mutationFn: () => deleteAlbum(a.id), onSuccess: () => { toast.success('Đã xoá album'); setConfirm(false); refresh() }, onError: (e) => toast.error(clubErrorMessage(e)) })
  const canEdit = isStaff || (mine && a.status === 'PENDING')
  return (
    <div className={cn('relative overflow-hidden rounded-[var(--radius-card)] border bg-surface', a.status === 'PENDING' ? 'border-warning/50' : 'border-border')}>
      <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" onClick={() => { if (a.status === 'APPROVED') void openAlbum(a.id) }} className="block">
        <div className="relative aspect-[4/3] overflow-hidden" style={{ background: `linear-gradient(135deg, ${p.color}55, ${p.color}10)` }}>
          {a.cover_path
            // eslint-disable-next-line @next/next/no-img-element -- ảnh bìa từ Supabase Storage
            ? <img src={postImageUrl(a.cover_path)} alt="" loading="lazy" className="size-full object-cover" />
            : <span className="grid size-full place-items-center"><Camera className="size-9 text-fg/60" aria-hidden /></span>}
          <span className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: p.color }}>{p.name}</span>
        </div>
        <div className="space-y-0.5 p-2.5">
          <p className="line-clamp-2 text-sm font-semibold leading-snug">{a.title}</p>
          <p className="flex items-center gap-1 text-[11px] text-fg-muted"><CalendarDays className="size-3" aria-hidden />{formatDay(a.taken_on)} · {ALBUM_KINDS[a.kind]}</p>
          {(a.race_name || a.event_title) && <p className="truncate text-[11px] text-fg-subtle">{a.race_name ?? a.event_title}</p>}
          {a.photographer && <p className="truncate text-[11px] text-fg-subtle">📷 {a.photographer}</p>}
          <p className="flex items-center gap-1 pt-0.5 text-[11px] font-semibold text-brand"><ExternalLink className="size-3" aria-hidden />Mở album</p>
        </div>
      </a>
      {(canEdit || mine) && (
        <button type="button" aria-label="Tuỳ chọn album" onClick={() => setMenu(true)}
          className="absolute right-1 top-1 grid size-9 place-items-center rounded-full bg-black/55 text-white"><MoreHorizontal className="size-4" aria-hidden /></button>
      )}
      {isStaff && a.status === 'PENDING' && (
        <div className="grid grid-cols-2 border-t border-border">
          <button type="button" disabled={review.isPending} onClick={() => review.mutate(false)} className="flex min-h-10 items-center justify-center gap-1 text-xs font-semibold text-fg-muted"><X className="size-3.5" aria-hidden />Từ chối</button>
          <button type="button" disabled={review.isPending} onClick={() => review.mutate(true)} className="flex min-h-10 items-center justify-center gap-1 bg-brand/15 text-xs font-semibold text-brand"><Check className="size-3.5" aria-hidden />Duyệt</button>
        </div>
      )}
      <Sheet open={menu} onClose={() => setMenu(false)} title={a.title}>
        <div className="space-y-1">
          {canEdit && <MenuItem icon={Pencil} label="Sửa" onClick={() => { setMenu(false); onEdit(a) }} />}
          <MenuItem icon={Trash2} label="Xoá album" danger onClick={() => { setMenu(false); setConfirm(true) }} />
          {isStaff && a.status === 'APPROVED' && <p className="px-3 pt-2 text-xs text-fg-muted">{a.opens} lượt mở · gửi bởi {a.created_by_name ?? '—'}</p>}
        </div>
      </Sheet>
      <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} title="Xoá album khỏi kho ảnh?" confirmLabel="Xoá" loading={del.isPending}
        description="Chỉ xoá link trong RaceHub, ảnh gốc vẫn còn ở nơi lưu trữ." onConfirm={() => del.mutate()} />
    </div>
  )
}

const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)

function AlbumSheet({ clubId, uid, isStaff, a, onClose }: { clubId: string; uid: string; isStaff: boolean; a: Partial<ClubAlbum>; onClose: () => void }) {
  const refresh = useRefreshAlbums(clubId)
  const [f, setF] = useState<AlbumInput>({
    id: a.id, title: a.title ?? '', url: a.url ?? '', description: a.description ?? '', kind: a.kind ?? 'EVENT', taken_on: a.taken_on ?? today(),
    event_id: a.event_id ?? null, race_name: a.race_name ?? '', cover_path: a.cover_path ?? null, photographer: a.photographer ?? '', notify: false,
  })
  const [uploading, setUploading] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const events = useQuery({ queryKey: ['club', clubId, 'events', 'PAST'], queryFn: () => listEvents(clubId, 'PAST'), enabled: f.kind === 'EVENT' || f.kind === 'TRAINING' })
  const set = <K extends keyof AlbumInput>(k: K, v: AlbumInput[K]) => setF((x) => ({ ...x, [k]: v }))
  const urlOk = isHttpUrl(f.url)
  const save = useMutation({
    mutationFn: () => saveAlbum(clubId, { ...f, url: f.url.trim(), title: f.title.trim() }),
    onSuccess: () => { toast.success(a.id ? 'Đã lưu' : isStaff ? 'Đã thêm album vào kho ảnh' : 'Đã gửi — chờ ban chủ nhiệm duyệt'); refresh(); onClose() },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const upload = async (fl: File) => {
    setUploading(true)
    try { set('cover_path', await uploadPostImage(clubId, uid, fl)) } catch (e) { toast.error(clubErrorMessage(e)) } finally { setUploading(false) }
  }
  return (
    <Sheet open onClose={onClose} title={a.id ? 'Sửa album' : isStaff ? 'Thêm album ảnh' : 'Gửi link album'}
      description={isStaff ? undefined : 'Ban chủ nhiệm duyệt xong, cả CLB sẽ thấy.'}
      footer={<Button block loading={save.isPending} disabled={!urlOk || f.title.trim().length < 3 || uploading} onClick={() => save.mutate()}>{a.id ? 'Lưu' : isStaff ? 'Thêm vào kho' : 'Gửi duyệt'}</Button>}>
      <div className="space-y-4">
        <Field label="Link album" htmlFor="al-url" error={f.url && !urlOk ? 'Dán link bắt đầu bằng https://' : null}
          hint={urlOk ? `Nhận diện: ${providerOf(f.url).name}` : 'Google Photos, Drive, Facebook, iCloud, OneDrive, trang ảnh của giải…'}>
          <Input id="al-url" value={f.url} inputMode="url" onChange={(e) => set('url', e.target.value)} placeholder="https://photos.app.goo.gl/…" />
        </Field>
        <Field label="Tên album" htmlFor="al-title">
          <Input id="al-title" value={f.title} maxLength={120} onChange={(e) => set('title', e.target.value)} placeholder="Long run Hồ Tây 20/9" />
        </Field>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Loại album">
          {(Object.keys(ALBUM_KINDS) as AlbumKind[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={f.kind === k} onClick={() => set('kind', k)}
              className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold', f.kind === k ? 'border-brand bg-brand/15 text-fg' : 'border-border text-fg-muted')}>{ALBUM_KINDS[k]}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ngày chụp" htmlFor="al-date"><Input id="al-date" type="date" value={f.taken_on} max={today()} onChange={(e) => set('taken_on', e.target.value)} /></Field>
          <Field label="Người chụp" htmlFor="al-by"><Input id="al-by" value={f.photographer ?? ''} maxLength={80} onChange={(e) => set('photographer', e.target.value)} placeholder="Không bắt buộc" /></Field>
        </div>
        {f.kind === 'RACE' && (
          <Field label="Tên giải" htmlFor="al-race"><Input id="al-race" value={f.race_name ?? ''} maxLength={120} onChange={(e) => set('race_name', e.target.value)} placeholder="VnExpress Marathon Huế 2026" /></Field>
        )}
        {(f.kind === 'EVENT' || f.kind === 'TRAINING') && (events.data?.length ?? 0) > 0 && (
          <Field label="Gắn với sự kiện CLB" htmlFor="al-ev">
            <select id="al-ev" value={f.event_id ?? ''} onChange={(e) => set('event_id', e.target.value || null)} className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px]">
              <option value="">— Không gắn —</option>
              {events.data!.map((e) => <option key={e.id} value={e.id}>{e.title} · {formatDay(e.starts_at)}</option>)}
            </select>
          </Field>
        )}
        <Field label="Ghi chú" htmlFor="al-desc"><Textarea id="al-desc" rows={2} maxLength={500} value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="Mật khẩu album (nếu có), số ảnh, cách tìm ảnh của mình…" /></Field>
        <Field label="Ảnh bìa (không bắt buộc)">
          <div className="flex items-center gap-3">
            {f.cover_path
              // eslint-disable-next-line @next/next/no-img-element -- xem trước ảnh bìa
              ? <img src={postImageUrl(f.cover_path)} alt="" className="h-16 w-24 rounded-lg border border-border object-cover" />
              : <span className="grid h-16 w-24 place-items-center rounded-lg border border-dashed border-border text-fg-subtle"><Camera className="size-5" aria-hidden /></span>}
            <Button size="sm" variant="secondary" loading={uploading} onClick={() => file.current?.click()}><Upload className="size-4" aria-hidden />Chọn ảnh</Button>
            {f.cover_path && <Button size="sm" variant="ghost" onClick={() => set('cover_path', null)}>Bỏ</Button>}
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const x = e.target.files?.[0]; if (x) void upload(x); e.target.value = '' }} />
          </div>
        </Field>
        {isStaff && !a.id && <SwitchRow checked={!!f.notify} onChange={(v) => set('notify', v)} label="Báo cho cả CLB" description="Thành viên nhận thông báo có album mới" />}
      </div>
    </Sheet>
  )
}
