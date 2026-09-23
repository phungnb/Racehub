'use client'

import { useEffect, useState } from 'react'
import {
  ROLE_LABEL,
  clubErrorMessage,
  isStaff,
  outranks,
  removeMember,
  setMemberRole,
  setMemberStatus,
  transferOwnership,
  type ClubMember,
  type ClubRole,
} from '../api'
import AthleteProfile from '@/features/profile/components/AthleteProfile'

/* ────────────────────────────────────────────────────────────
 * MemberActionModal – bảng thông tin & thao tác với 1 thành viên
 *  - Ai cũng xem được hồ sơ; chỉ người đủ quyền mới thấy khu quản trị
 *  - Mọi thao tác gọi API thật, xác nhận ngay trong bảng (không dùng confirm())
 *  - Trên điện thoại hiện dạng bảng trượt từ dưới lên
 * ──────────────────────────────────────────────────────────── */

interface Props {
  member: ClubMember | null
  isOpen: boolean
  onClose: () => void
  myRole: ClubRole | null
  clubId: string
  onActionSuccess: () => void
  notify: (text: string, tone?: 'ok' | 'err') => void
  /** Để nhận biết "Bạn" và không cho tự thao tác lên chính mình */
  myUserId?: string
}

/** Mô tả quyền của từng vai trò. Chỉnh cho khớp với phân quyền thật của hệ thống. */
const ROLE_HINT: Record<string, string> = {
  VICE_OWNER: 'Duyệt thành viên, quản lý thành viên và thử thách.',
  CONTENT_ADMIN: 'Đăng thông báo và quản lý nội dung của CLB.',
  CHALLENGE_ADMIN: 'Tạo và quản lý thử thách của CLB.',
  CAPTAIN: 'Hỗ trợ điều phối các buổi chạy chung.',
  MEMBER: 'Tham gia hoạt động và thử thách của CLB.',
}
const ASSIGNABLE: ClubRole[] = ['VICE_OWNER', 'CONTENT_ADMIN', 'CHALLENGE_ADMIN', 'CAPTAIN', 'MEMBER'] as ClubRole[]

const STATUS_LABEL: Record<string, string> = {
  APPROVED: 'Chính thức',
  PENDING: 'Chờ duyệt',
  REJECTED: 'Đã từ chối',
  BANNED: 'Bị chặn',
}

type Confirm = 'remove' | 'ban' | 'transfer' | null

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('vi-VN') : '—')

/* Avatar chữ cái, màu ổn định theo tên – dùng chung với ClubMembersManager */
const TONES = [
  'from-brand to-amber-500',
  'from-indigo-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-violet-500 to-purple-600',
  'from-sky-500 to-cyan-600',
]
export function MemberAvatar({ name, size = 40 }: { name: string; size?: number }) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <span
      aria-hidden
      className={`shrink-0 rounded-full bg-gradient-to-br ${TONES[h % TONES.length]} text-white font-black flex items-center justify-center`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {name.trim().substring(0, 2).toUpperCase()}
    </span>
  )
}

export default function MemberActionModal({
  member,
  isOpen,
  onClose,
  myRole,
  clubId,
  onActionSuccess,
  notify,
  myUserId,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [selectedRole, setSelectedRole] = useState<ClubRole>('MEMBER')
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [showAthlete, setShowAthlete] = useState(false)

  // Đồng bộ lại mỗi khi mở thành viên khác
  useEffect(() => {
    if (member) setSelectedRole(member.role)
    setConfirm(null)
    setShowAthlete(false)
  }, [member?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Nhấn Esc để đóng
  useEffect(() => {
    if (!isOpen || showAthlete) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, showAthlete, onClose])

  if (!isOpen || !member) return null

  const name = member.profile?.display_name || `Runner ${member.user_id.substring(0, 6)}`
  const isMe = !!myUserId && member.user_id === myUserId

  // Quyền: đổi vai trò / chuyển quyền chỉ Chủ nhiệm; chặn & xóa cần cấp cao hơn đối tượng
  const isApproved = member.status === 'APPROVED'
  const canChangeRole = myRole === 'OWNER' && member.role !== 'OWNER' && isApproved && !isMe
  const canRemove =
    isStaff(myRole) && outranks(myRole, member.role) && member.role !== 'OWNER' && !isMe
  const canTransfer = myRole === 'OWNER' && isApproved && member.role !== 'OWNER' && !isMe
  const hasAdminArea = canChangeRole || canRemove || canTransfer

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true)
    try {
      await fn()
      notify(okMsg)
      onActionSuccess()
      onClose()
    } catch (e) {
      notify(clubErrorMessage(e), 'err')
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const CONFIRMS = {
    remove: {
      title: `Xóa ${name} khỏi CLB?`,
      body: 'Thành viên sẽ rời CLB và có thể xin tham gia lại.',
      cta: 'Xóa khỏi CLB',
      run: () => run(() => removeMember(member.id), 'Đã xóa thành viên khỏi CLB.'),
    },
    ban: {
      title: `Chặn ${name}?`,
      body: 'Thành viên sẽ bị đưa ra khỏi CLB và bị hạn chế tham gia lại cho đến khi bạn gỡ chặn.',
      cta: 'Chặn thành viên',
      run: () => run(() => setMemberStatus(member.id, 'BANNED'), 'Đã chặn thành viên.'),
    },
    transfer: {
      title: `Trao quyền Chủ nhiệm cho ${name}?`,
      body: 'Bạn sẽ trở thành Phó Chủ nhiệm. Chỉ chủ nhiệm mới có thể lấy lại quyền này.',
      cta: 'Trao quyền',
      run: () =>
        run(() => transferOwnership(clubId, member.user_id), 'Đã trao quyền Chủ nhiệm.'),
    },
  } as const
  const pending = confirm ? CONFIRMS[confirm] : null

  return (
    <>
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Thành viên ${name}`}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 animate-fadeIn"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-border rounded-t-3xl sm:rounded-3xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-5 flex items-center gap-3 border-b border-border">
          <MemberAvatar name={name} size={56} />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-black text-white truncate">
              {name}
              {isMe && <span className="ml-1.5 text-brand font-bold">(Bạn)</span>}
            </h3>
            <span
              className={`inline-block mt-1 text-xs font-bold px-2 py-0.5 rounded ${
                member.role === 'OWNER'
                  ? 'bg-amber-500/20 text-amber-400'
                  : member.role === 'MEMBER'
                  ? 'bg-surface-2 text-fg'
                  : 'bg-brand/20 text-brand'
              }`}
            >
              {ROLE_LABEL[member.role]}
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="w-8 h-8 rounded-full bg-surface-2 hover:bg-border text-fg flex items-center justify-center text-xs font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          {/* Thông tin */}
          <dl className="grid grid-cols-2 gap-2">
            {[
              ['Level', String(member.profile?.level ?? 1)],
              ['Kinh nghiệm', `${(member.profile?.xp ?? 0).toLocaleString('vi-VN')} XP`],
              ['Tham gia', fmtDate(member.joined_at)],
              ['Trạng thái', STATUS_LABEL[member.status] ?? member.status],
            ].map(([k, v]) => (
              <div key={k} className="bg-bg rounded-xl p-3">
                <dt className="text-fg-subtle">{k}</dt>
                <dd className="text-white font-bold mt-0.5">{v}</dd>
              </div>
            ))}
          </dl>

          <button
            onClick={() => setShowAthlete(true)}
            className="w-full flex items-center justify-between bg-bg hover:bg-surface-2 border border-border text-white font-bold px-3.5 py-3 rounded-xl cursor-pointer transition-colors"
          >
            <span>Xem hồ sơ và hoạt động</span>
            <span className="text-fg-subtle" aria-hidden>›</span>
          </button>

          {/* Xác nhận thao tác nguy hiểm */}
          {pending ? (
            <div className="bg-rose-950/30 border border-rose-900/60 rounded-2xl p-4 space-y-3">
              <p className="text-sm font-bold text-white">{pending.title}</p>
              <p className="text-fg-muted">{pending.body}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirm(null)}
                  disabled={busy}
                  className="flex-1 bg-surface-2 hover:bg-border text-fg font-bold py-2.5 rounded-xl cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  onClick={pending.run}
                  disabled={busy}
                  className="flex-1 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-black py-2.5 rounded-xl cursor-pointer"
                >
                  {busy ? 'Đang xử lý…' : pending.cta}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Chọn vai trò */}
              {canChangeRole && (
                <section className="space-y-2" aria-labelledby="role-title">
                  <h4 id="role-title" className="font-bold text-fg">Vai trò trong CLB</h4>
                  <div role="radiogroup" className="space-y-1.5">
                    {ASSIGNABLE.map((r) => (
                      <label
                        key={r}
                        className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                          selectedRole === r
                            ? 'bg-brand/10 border-brand/40'
                            : 'bg-bg border-border hover:border-fg-subtle'
                        }`}
                      >
                        <input
                          type="radio"
                          name="member-role"
                          checked={selectedRole === r}
                          onChange={() => setSelectedRole(r)}
                          className="accent-brand mt-0.5"
                        />
                        <span>
                          <span className="block font-bold text-fg">{ROLE_LABEL[r]}</span>
                          <span className="block text-[11px] text-fg-subtle">{ROLE_HINT[r]}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={() =>
                      run(() => setMemberRole(member.id, selectedRole), 'Đã cập nhật vai trò.')
                    }
                    disabled={busy || selectedRole === member.role}
                    className="w-full bg-brand hover:bg-brand-strong disabled:opacity-40 text-brand-fg font-black py-2.5 rounded-xl cursor-pointer"
                  >
                    {busy ? 'Đang lưu…' : 'Lưu vai trò'}
                  </button>
                </section>
              )}

              {/* Khu thao tác quản trị */}
              {(canRemove || canTransfer) && (
                <section className="space-y-2 pt-1" aria-label="Thao tác quản trị">
                  {canTransfer && (
                    <button
                      onClick={() => setConfirm('transfer')}
                      className="w-full text-left bg-bg hover:bg-surface-2 border border-border text-amber-400 font-bold px-3.5 py-3 rounded-xl cursor-pointer"
                    >
                      Trao quyền Chủ nhiệm
                    </button>
                  )}
                  {canRemove && (
                    <>
                      <button
                        onClick={() => setConfirm('ban')}
                        className="w-full text-left bg-bg hover:bg-surface-2 border border-border text-rose-400 font-bold px-3.5 py-3 rounded-xl cursor-pointer"
                      >
                        Chặn khỏi CLB
                      </button>
                      <button
                        onClick={() => setConfirm('remove')}
                        className="w-full text-left bg-bg hover:bg-surface-2 border border-border text-rose-400 font-bold px-3.5 py-3 rounded-xl cursor-pointer"
                      >
                        Xóa khỏi CLB
                      </button>
                    </>
                  )}
                </section>
              )}

              {!hasAdminArea && (
                <p className="text-center text-[11px] text-fg-subtle bg-bg/50 border border-border/60 rounded-xl p-3">
                  Bạn chỉ có thể xem thông tin thành viên này.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
    {showAthlete && (
      <AthleteProfile userId={member.user_id} onClose={() => setShowAthlete(false)} />
    )}
    </>
  )
}
