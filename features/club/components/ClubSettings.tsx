'use client'

import { useEffect, useRef, useState } from 'react'
import type { Club, ClubRole, JoinPolicy } from '../api/clubApi'
import {
  clubErrorMessage,
  JOIN_POLICY_LABEL,
  deleteClub,
  removeClubAvatar,
  setClubAnnouncement,
  updateClub,
  updateClubPolicy,
  uploadClubAvatar,
} from '../api/clubApi'

/** Ảnh đại diện CLB, tự lùi về chữ cái đầu khi chưa có ảnh. */
export function ClubAvatar({
  club,
  size = 48,
  className = '',
}: {
  club: Pick<Club, 'name' | 'avatar_url'>
  size?: number
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [club.avatar_url])

  const style = { width: size, height: size }

  if (club.avatar_url && !broken) {
    return (
      <img
        src={club.avatar_url}
        alt=""
        style={style}
        onError={() => setBroken(true)}
        className={`shrink-0 rounded-xl object-cover bg-surface-2 ${className}`}
      />
    )
  }
  return (
    <div
      style={style}
      className={`shrink-0 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-xl flex items-center justify-center text-white font-black shadow-md ${className}`}
    >
      <span style={{ fontSize: size * 0.34 }}>{club.name.substring(0, 2).toUpperCase()}</span>
    </div>
  )
}

/* ================================================================= */

interface Props {
  club: Club
  myRole: ClubRole | null
  onChanged: (club: Club) => void
  onDeleted: () => void
  notify: (text: string, tone?: 'ok' | 'err') => void
}

const card = 'bg-surface border border-border rounded-2xl p-4 space-y-3 shadow-xl'
const input =
  'w-full bg-bg border border-border rounded-xl p-2.5 text-xs text-white outline-none focus:border-brand'
const label = 'text-xs text-fg-muted block mb-1'

export default function ClubSettings({ club, myRole, onChanged, onDeleted, notify }: Props) {
  const isOwner = myRole === 'OWNER'
  const fileRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(club.name)
  const [description, setDescription] = useState(club.description ?? '')
  const [announcement, setAnnouncement] = useState(club.announcement ?? '')
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>(club.join_policy)
  const [memberLimit, setMemberLimit] = useState(String(club.member_limit))
  const [busy, setBusy] = useState<string | null>(null)

  // Đồng bộ lại khi realtime đẩy thay đổi từ người khác
  useEffect(() => {
    setName(club.name)
    setDescription(club.description ?? '')
    setAnnouncement(club.announcement ?? '')
    setJoinPolicy(club.join_policy)
    setMemberLimit(String(club.member_limit))
  }, [club.id, club.name, club.description, club.announcement, club.join_policy, club.member_limit])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      notify(clubErrorMessage(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  const pickAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // cho phép chọn lại cùng file
    if (!file) return
    run('avatar', async () => {
      onChanged(await uploadClubAvatar(club.id, file))
      notify('Đã cập nhật ảnh đại diện.')
    })
  }

  const profileDirty = name.trim() !== club.name || description.trim() !== (club.description ?? '')
  const policyDirty =
    joinPolicy !== club.join_policy || Number(memberLimit) !== club.member_limit

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* ------------------------- Ảnh đại diện ------------------------- */}
      <div className={card}>
        <h3 className="text-sm font-bold text-fg">Ảnh đại diện</h3>
        <div className="flex items-center gap-4">
          <ClubAvatar club={club} size={64} />
          <div className="flex flex-col gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={pickAvatar}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy === 'avatar'}
              className="bg-surface-2 hover:bg-border disabled:opacity-50 text-fg text-[11px] font-bold px-3 py-1.5 rounded-lg cursor-pointer"
            >
              {busy === 'avatar' ? 'Đang tải lên…' : 'Chọn ảnh mới'}
            </button>
            {club.avatar_url && (
              <button
                onClick={() =>
                  run('avatar-del', async () => {
                    onChanged(await removeClubAvatar(club.id))
                    notify('Đã gỡ ảnh đại diện.')
                  })
                }
                disabled={busy === 'avatar-del'}
                className="text-[11px] text-fg-muted hover:text-rose-400 font-bold px-3 py-1 rounded-lg cursor-pointer text-left"
              >
                Gỡ ảnh
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-fg-subtle">JPG, PNG hoặc WebP, tối đa 2 MB. Ảnh vuông hiển thị đẹp nhất.</p>
      </div>

      {/* --------------------------- Hồ sơ ----------------------------- */}
      <div className={card}>
        <h3 className="text-sm font-bold text-fg">Hồ sơ Câu lạc bộ</h3>
        <div>
          <label htmlFor="set-name" className={label}>Tên</label>
          <input id="set-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor="set-desc" className={label}>
            Mô tả <span className="text-fg-subtle">({description.length}/300)</span>
          </label>
          <textarea
            id="set-desc"
            value={description}
            maxLength={300}
            onChange={(e) => setDescription(e.target.value)}
            className={`${input} h-20 resize-none`}
          />
        </div>
        <button
          onClick={() =>
            run('profile', async () => {
              onChanged(await updateClub(club.id, { name: name.trim(), description: description.trim() }))
              notify('Đã lưu hồ sơ Câu lạc bộ.')
            })
          }
          disabled={busy === 'profile' || !profileDirty || !name.trim()}
          className="w-full bg-brand hover:bg-brand-strong disabled:opacity-40 text-brand-fg font-black py-2.5 rounded-xl text-xs cursor-pointer"
        >
          {busy === 'profile' ? 'Đang lưu…' : 'Lưu hồ sơ'}
        </button>
      </div>

      {/* ----------------------- Thông báo ghim ------------------------ */}
      <div className={card}>
        <h3 className="text-sm font-bold text-fg">Thông báo ghim</h3>
        <p className="text-xs text-fg-subtle">Hiện ở đầu tab Tổng quan cho mọi thành viên.</p>
        <textarea
          value={announcement}
          maxLength={500}
          placeholder="Chủ nhật 6h sáng chạy chung ở hồ Tây, tập trung cổng công viên nước."
          onChange={(e) => setAnnouncement(e.target.value)}
          className={`${input} h-24 resize-none`}
        />
        <div className="flex gap-2">
          <button
            onClick={() =>
              run('ann', async () => {
                onChanged(await setClubAnnouncement(club.id, announcement))
                notify(announcement.trim() ? 'Đã ghim thông báo.' : 'Đã gỡ thông báo.')
              })
            }
            disabled={busy === 'ann' || announcement === (club.announcement ?? '')}
            className="flex-1 bg-brand hover:bg-brand-strong disabled:opacity-40 text-brand-fg font-black py-2.5 rounded-xl text-xs cursor-pointer"
          >
            {busy === 'ann' ? 'Đang lưu…' : 'Ghim thông báo'}
          </button>
          {club.announcement && (
            <button
              onClick={() => setAnnouncement('')}
              className="bg-surface-2 hover:bg-border text-fg font-bold px-3 rounded-xl text-xs cursor-pointer"
            >
              Xoá nội dung
            </button>
          )}
        </div>
      </div>

      {/* ------------------- Chỉ Chủ nhiệm mới thấy -------------------- */}
      {isOwner && (
        <>
          <div className={card}>
            <h3 className="text-sm font-bold text-fg">Cách nhận thành viên</h3>
            <div className="space-y-1.5">
              {(Object.keys(JOIN_POLICY_LABEL) as JoinPolicy[]).map((p) => (
                <label
                  key={p}
                  className={`flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                    joinPolicy === p ? 'bg-brand/10 border-brand/40' : 'bg-bg border-border'
                  }`}
                >
                  <input
                    type="radio"
                    name="join-policy"
                    checked={joinPolicy === p}
                    onChange={() => setJoinPolicy(p)}
                    className="accent-brand"
                  />
                  <span className="text-xs text-fg">{JOIN_POLICY_LABEL[p]}</span>
                </label>
              ))}
            </div>

            <div>
              <label htmlFor="set-limit" className={label}>
                Giới hạn thành viên (hiện có {club.member_count})
              </label>
              <input
                id="set-limit"
                type="number"
                min={Math.max(club.member_count, 2)}
                max={1000}
                value={memberLimit}
                onChange={(e) => setMemberLimit(e.target.value)}
                className={input}
              />
            </div>

            {joinPolicy === 'OPEN' && club.join_policy !== 'OPEN' && (
              <p className="text-xs text-amber-400">
                Chuyển sang chế độ này sẽ duyệt luôn toàn bộ người đang chờ.
              </p>
            )}

            <button
              onClick={() =>
                run('policy', async () => {
                  onChanged(
                    await updateClubPolicy(club.id, {
                      joinPolicy,
                      memberLimit: Number(memberLimit),
                    }),
                  )
                  notify('Đã cập nhật cách nhận thành viên.')
                })
              }
              disabled={busy === 'policy' || !policyDirty}
              className="w-full bg-brand hover:bg-brand-strong disabled:opacity-40 text-brand-fg font-black py-2.5 rounded-xl text-xs cursor-pointer"
            >
              {busy === 'policy' ? 'Đang lưu…' : 'Lưu cài đặt'}
            </button>
          </div>

          <div className="bg-rose-950/30 border border-rose-900/60 rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-rose-400">Giải thể Câu lạc bộ</h3>
            <p className="text-[11px] text-fg-muted">
              Toàn bộ thành viên, quỹ và lịch sử hoạt động sẽ bị xoá vĩnh viễn.
            </p>
            <button
              onClick={() => {
                if (!confirm(`Bạn có chắc chắn muốn giải thể vĩnh viễn CLB "${club.name}" không?`)) return
                run('delete', async () => {
                  await deleteClub(club.id)
                  notify('Đã giải thể Câu lạc bộ.')
                  onDeleted()
                })
              }}
              disabled={busy === 'delete'}
              className="w-full bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white font-black py-2.5 rounded-xl text-xs cursor-pointer"
            >
              {busy === 'delete' ? 'Đang xoá…' : 'Giải thể vĩnh viễn'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}