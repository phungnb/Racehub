'use client'

import { useRef, useState } from 'react'
import { ImagePlus, Megaphone, X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Field, Input, Sheet, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { clubErrorMessage } from '../../api/clubApi'
import { MAX_POST_IMAGES, uploadPostImage } from '../../api/postsApi'
import { usePostActions } from '../../hooks/useClubFeed'

interface Me { id: string; name: string | null; avatar: string | null }

/** Ô "Chia sẻ với CLB…" → bảng soạn bài (ảnh, thông báo ghim cho ban quản trị) */
export function Composer({ clubId, me, canAnnounce }: { clubId: string; me: Me; canAnnounce: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3 text-left transition-colors hover:border-fg-subtle">
        <Avatar src={me.avatar} name={me.name} size="md" />
        <span className="flex-1 text-[15px] text-fg-subtle">Chia sẻ với CLB…</span>
        <ImagePlus className="size-5 text-fg-subtle" aria-hidden />
      </button>
      {open && <ComposerSheet clubId={clubId} me={me} canAnnounce={canAnnounce} onClose={() => setOpen(false)} />}
    </>
  )
}

function ComposerSheet({ clubId, me, canAnnounce, onClose }: { clubId: string; me: Me; canAnnounce: boolean; onClose: () => void }) {
  const { create } = usePostActions(clubId)
  const [body, setBody] = useState('')
  const [title, setTitle] = useState('')
  const [announce, setAnnounce] = useState(false)
  const [files, setFiles] = useState<{ file: File; url: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const pick = (list: FileList | null) => {
    if (!list) return
    const next = [...files, ...Array.from(list).map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, MAX_POST_IMAGES)
    if (files.length + list.length > MAX_POST_IMAGES) toast(`Tối đa ${MAX_POST_IMAGES} ảnh mỗi bài.`)
    setFiles(next)
  }

  const submit = async () => {
    try {
      setUploading(true)
      const paths = await Promise.all(files.map((f) => uploadPostImage(clubId, me.id, f.file)))
      await create.mutateAsync({ clubId, body: body.trim(), title: announce ? title.trim() || null : null, announcement: announce, imagePaths: paths })
      files.forEach((f) => URL.revokeObjectURL(f.url))
      toast.success(announce ? 'Đã ghim thông báo và báo cho cả CLB.' : 'Đã đăng.')
      onClose()
    } catch (e) {
      toast.error(clubErrorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  const busy = uploading || create.isPending
  const empty = !body.trim() && files.length === 0
  return (
    <Sheet open onClose={onClose} title={announce ? 'Thông báo cho cả CLB' : 'Bài đăng mới'}
      footer={<Button block onClick={submit} loading={busy} disabled={empty}>{announce ? 'Ghim và thông báo' : 'Đăng'}</Button>}>
      <div className="space-y-4">
        {canAnnounce && (
          <button type="button" role="switch" aria-checked={announce} onClick={() => setAnnounce((v) => !v)}
            className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
              announce ? 'border-coin/50 bg-coin/10' : 'border-border hover:border-fg-subtle')}>
            <Megaphone className={cn('size-5', announce ? 'text-coin' : 'text-fg-subtle')} aria-hidden />
            <span className="flex-1">
              <span className="block text-sm font-semibold">Đăng thành thông báo ghim</span>
              <span className="block text-xs text-fg-muted">Ghim đầu bảng tin và gửi thông báo tới mọi thành viên</span>
            </span>
            <span className={cn('h-6 w-10 rounded-full p-0.5 transition-colors', announce ? 'bg-coin' : 'bg-surface-2')}>
              <span className={cn('block size-5 rounded-full bg-fg transition-transform', announce && 'translate-x-4')} />
            </span>
          </button>
        )}
        {announce && (
          <Field label="Tiêu đề" htmlFor="post-title">
            <Input id="post-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="VD: Lịch chạy dài Chủ nhật" />
          </Field>
        )}
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} autoFocus aria-label="Nội dung"
          placeholder={announce ? 'Nội dung thông báo…' : 'Hôm nay bạn chạy thế nào? Rủ mọi người đi chạy?'} className="min-h-32" />
        {files.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {files.map((f, i) => (
              <div key={f.url} className="relative aspect-square overflow-hidden rounded-xl border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element -- ảnh xem trước từ máy người dùng */}
                <img src={f.url} alt="" className="size-full object-cover" />
                <button type="button" aria-label="Bỏ ảnh" onClick={() => { URL.revokeObjectURL(f.url); setFiles(files.filter((_, j) => j !== i)) }}
                  className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-black/70 text-white">
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = '' }} />
        <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()} disabled={files.length >= MAX_POST_IMAGES}>
          <ImagePlus className="size-4" aria-hidden />Thêm ảnh ({files.length}/{MAX_POST_IMAGES})
        </Button>
      </div>
    </Sheet>
  )
}
