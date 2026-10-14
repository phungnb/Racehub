'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Flag, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, EmptyState, Field, Input, Skeleton, Textarea } from '@/shared/ui'
import { useOrganizer } from '../hooks/useOrganizer'
import { deleteListing, getListing, importFromUrl, saveListing, type ListingInput, type ListingStatus } from '../api/listingApi'

const EMPTY: ListingInput = {
  title: '', race_date: '', end_date: null, location: null, province: null, distances: [], organizer: null,
  reg_url: null, source_url: null, image_url: null, reg_close_date: null, description: null, status: 'DRAFT',
}
const nil = (s: string) => (s.trim() ? s.trim() : null)
const httpUrl = (s: string) => !s || /^https?:\/\/\S+$/i.test(s)

/** Admin đăng / sửa tin giải offline. Dán link trang giải để gợi ý điền form; lưu nháp trước, bấm "Đăng" mới hiện cho mọi người. */
export function ListingFormScreen({ id }: { id: string | null }) {
  const { isAdmin, isLoading } = useOrganizer()
  const existing = useQuery({ queryKey: ['race-listing', id], queryFn: () => getListing(id as string), enabled: !!id && isAdmin })
  if (isLoading || (id && existing.isPending)) return <Skeleton className="h-96" />
  if (!isAdmin) return <EmptyState icon={Flag} title="Chỉ admin được đăng tin giải" description="Tin giải chạy ngoài đời do RaceHub đăng." />
  if (id && !existing.data) return <EmptyState icon={Flag} title="Không tìm thấy tin giải" description="Tin này đã bị xóa hoặc không tồn tại." />
  const { id: _id, ...init } = existing.data ?? { id: '', ...EMPTY } // eslint-disable-line @typescript-eslint/no-unused-vars
  return <ListingForm id={id} init={init} />
}

function ListingForm({ id, init }: { id: string | null; init: ListingInput }) {
  const router = useRouter()
  const qc = useQueryClient()
  const [v, setV] = useState<ListingInput>(init)
  const [link, setLink] = useState('')
  const [dist, setDist] = useState(init.distances.join(', '))
  const set = <K extends keyof ListingInput>(k: K, x: ListingInput[K]) => setV((p) => ({ ...p, [k]: x }))

  const imp = useMutation({
    mutationFn: () => importFromUrl(link.trim()),
    onSuccess: ({ source_url, draft }) => {
      setV((p) => ({
        ...p, source_url, reg_url: p.reg_url ?? source_url,
        title: draft.title || p.title, race_date: draft.race_date || p.race_date, end_date: draft.end_date || p.end_date,
        location: draft.location || p.location, organizer: draft.organizer || p.organizer,
        image_url: draft.image_url || p.image_url, description: draft.description || p.description,
        distances: draft.distances.length ? draft.distances : p.distances,
      }))
      if (draft.distances.length) setDist(draft.distances.join(', '))
      toast.success('Đã điền gợi ý — kiểm tra lại từng ô trước khi lưu')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Không đọc được trang này.'),
  })
  const save = useMutation({
    mutationFn: async (status: ListingStatus) => {
      const distances = dist.split(/[,;]/).map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 12)
      return saveListing(id, { ...v, distances, title: v.title.trim(), status })
    },
    onSuccess: (_i, status) => {
      void qc.invalidateQueries({ queryKey: ['race-listings'] }); void qc.invalidateQueries({ queryKey: ['race-listing'] })
      toast.success(status === 'PUBLISHED' ? 'Đã đăng' : 'Đã lưu')
      router.replace('/races')
    },
    onError: (e) => toast.error(/race_listings_source_uniq|duplicate/i.test(String((e as Error).message)) ? 'Giải này đã được đăng (trùng link nguồn).' : 'Không lưu được, kiểm tra lại các ô.'),
  })
  const del = useMutation({
    mutationFn: () => deleteListing(id as string),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['race-listings'] }); toast.success('Đã xóa'); router.replace('/races') },
    onError: () => toast.error('Không xóa được'),
  })

  const urlsOk = httpUrl(v.reg_url ?? '') && httpUrl(v.image_url ?? '') && httpUrl(v.source_url ?? '')
  const valid = v.title.trim().length >= 3 && !!v.race_date && urlsOk && (!v.end_date || v.end_date >= v.race_date)

  return (
    <div className="space-y-5 pb-6">
      <Link href="/races" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" aria-hidden />Race</Link>
      <h1 className="text-2xl font-bold">{id ? 'Sửa tin giải' : 'Đăng tin giải'}</h1>

      <Field label="Dán link trang giải" hint="Tự điền tên, ngày, địa điểm, ảnh, cự ly nếu trang có. Chỉ là gợi ý — bạn kiểm tra rồi mới lưu.">
        <div className="flex gap-2">
          <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" inputMode="url" aria-label="Link trang giải" />
          <Button type="button" variant="secondary" className="shrink-0" disabled={!/^https?:\/\//i.test(link.trim()) || imp.isPending} onClick={() => imp.mutate()}>
            <Wand2 className="size-4" aria-hidden />{imp.isPending ? 'Đang đọc…' : 'Điền'}
          </Button>
        </div>
      </Field>

      <Field label="Tên giải" htmlFor="l-title"><Input id="l-title" value={v.title} onChange={(e) => set('title', e.target.value)} maxLength={160} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ngày thi đấu" htmlFor="l-date"><Input id="l-date" type="date" value={v.race_date} onChange={(e) => set('race_date', e.target.value)} /></Field>
        <Field label="Đến ngày (nếu nhiều ngày)" htmlFor="l-end"><Input id="l-end" type="date" value={v.end_date ?? ''} onChange={(e) => set('end_date', nil(e.target.value))} /></Field>
      </div>
      <Field label="Địa điểm" htmlFor="l-loc"><Input id="l-loc" value={v.location ?? ''} onChange={(e) => set('location', nil(e.target.value))} maxLength={200} /></Field>
      <Field label="Tỉnh / thành" htmlFor="l-prov"><Input id="l-prov" value={v.province ?? ''} onChange={(e) => set('province', nil(e.target.value))} maxLength={80} /></Field>
      <Field label="Cự ly" htmlFor="l-dist" hint="Cách nhau bằng dấu phẩy, VD: 5K, 10K, 21K, 42K">
        <Input id="l-dist" value={dist} onChange={(e) => setDist(e.target.value)} />
      </Field>
      <Field label="Ban tổ chức" htmlFor="l-org"><Input id="l-org" value={v.organizer ?? ''} onChange={(e) => set('organizer', nil(e.target.value))} maxLength={160} /></Field>
      <Field label="Link đăng ký" htmlFor="l-reg" error={httpUrl(v.reg_url ?? '') ? null : 'Phải bắt đầu bằng http(s)://'}>
        <Input id="l-reg" value={v.reg_url ?? ''} onChange={(e) => set('reg_url', nil(e.target.value))} inputMode="url" />
      </Field>
      <Field label="Hạn đăng ký" htmlFor="l-close"><Input id="l-close" type="date" value={v.reg_close_date ?? ''} onChange={(e) => set('reg_close_date', nil(e.target.value))} /></Field>
      <Field label="Link ảnh" htmlFor="l-img" error={httpUrl(v.image_url ?? '') ? null : 'Phải bắt đầu bằng http(s)://'}>
        <Input id="l-img" value={v.image_url ?? ''} onChange={(e) => set('image_url', nil(e.target.value))} inputMode="url" />
      </Field>
      <Field label="Giới thiệu ngắn" htmlFor="l-desc"><Textarea id="l-desc" value={v.description ?? ''} onChange={(e) => set('description', nil(e.target.value))} maxLength={3000} /></Field>

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!valid || save.isPending} onClick={() => save.mutate('PUBLISHED')}>Đăng</Button>
        <Button type="button" variant="secondary" disabled={!valid || save.isPending} onClick={() => save.mutate('DRAFT')}>Lưu nháp</Button>
        {id && v.status === 'PUBLISHED' && <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => save.mutate('HIDDEN')}>Ẩn</Button>}
        {id && <Button type="button" variant="ghost" disabled={del.isPending} onClick={() => { if (window.confirm('Xóa tin giải này?')) del.mutate() }}>Xóa</Button>}
      </div>
    </div>
  )
}
