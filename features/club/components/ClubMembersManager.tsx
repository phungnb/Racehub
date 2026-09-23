'use client'

import { useState, useEffect } from 'react'
import { 
  listMembers,
  setMemberStatus,
  setMemberRole,
  removeMember,
  transferOwnership,
  isStaff,
  outranks,
  ROLE_LABEL,
  clubErrorMessage,
  type ClubMember,
  type ClubRole,
  type MemberStatus
} from '../api';

interface Props {
  clubId: string
  myRole: ClubRole | null
  notify: (text: string, tone?: 'ok' | 'err') => void
}

export default function ClubMembersManager({ clubId, myRole, notify }: Props) {
  const [members, setMembers] = useState<ClubMember[]>([])
  const [loading, setLoading] = useState(true)
  const [actionBusyId, setActionBusyId] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'PENDING' | 'APPROVED'>('ALL')

  const loadMembers = async () => {
    setLoading(true)
    try {
      const data = await listMembers(clubId)
      setMembers(data)
    } catch (e) {
      notify(clubErrorMessage(e), 'err')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMembers()
  }, [clubId])

  const handleAction = async (id: string, fn: () => Promise<void>, successMsg: string) => {
    setActionBusyId(id)
    try {
      await fn()
      notify(successMsg)
      await loadMembers()
    } catch (e) {
      notify(clubErrorMessage(e), 'err')
    } finally {
      setActionBusyId(null)
    }
  }

  // Lọc danh sách thành viên
  const filteredMembers = members.filter(m => {
    if (filterStatus === 'PENDING') return m.status === 'PENDING'
    if (filterStatus === 'APPROVED') return m.status === 'APPROVED'
    return true
  })

  if (!isStaff(myRole)) {
    return (
      <div className="bg-surface border border-border rounded-2xl p-6 text-center text-xs text-fg-muted">
        Bạn cần có quyền quản trị để xem và quản lý thành viên.
      </div>
    )
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Bộ lọc trạng thái */}
      <div className="flex gap-2 bg-surface p-1.5 rounded-xl border border-border">
        <button
          onClick={() => setFilterStatus('ALL')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${filterStatus === 'ALL' ? 'bg-brand text-brand-fg' : 'text-fg-muted hover:text-white'}`}
        >
          Tất cả ({members.length})
        </button>
        <button
          onClick={() => setFilterStatus('PENDING')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${filterStatus === 'PENDING' ? 'bg-brand text-brand-fg' : 'text-fg-muted hover:text-white'}`}
        >
          Chờ duyệt ({members.filter(m => m.status === 'PENDING').length})
        </button>
        <button
          onClick={() => setFilterStatus('APPROVED')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${filterStatus === 'APPROVED' ? 'bg-brand text-brand-fg' : 'text-fg-muted hover:text-white'}`}
        >
          Chính thức ({members.filter(m => m.status === 'APPROVED').length})
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-xs text-fg-subtle">Đang tải danh sách thành viên…</div>
      ) : filteredMembers.length === 0 ? (
        <div className="bg-surface border border-border rounded-2xl p-6 text-center text-xs text-fg-muted">
          Không có thành viên nào trong danh sách này.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredMembers.map((m) => {
            const isBusy = actionBusyId === m.id
            const canManage = outranks(myRole, m.role) && m.role !== 'OWNER'
            const displayName = m.profile?.display_name || `Runner (${m.user_id.substring(0, 6)})`

            return (
              <div key={m.id} className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-xl flex items-center justify-center text-white font-bold text-sm">
                      {displayName.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">{displayName}</h4>
                      <p className="text-xs text-fg-muted">
                        Level {m.profile?.level || 1} • Tham gia: {new Date(m.joined_at).toLocaleDateString('vi-VN')}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                      m.status === 'APPROVED' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {m.status === 'APPROVED' ? (ROLE_LABEL[m.role] || m.role) : 'Đang chờ duyệt'}
                    </span>
                  </div>
                </div>

                {/* Khu vực nút bấm thao tác */}
                {canManage && (
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/80 flex-wrap">
                    {m.status === 'PENDING' ? (
                      <>
                        <button
                          disabled={isBusy}
                          onClick={() => handleAction(m.id, () => setMemberStatus(m.id, 'APPROVED'), 'Đã duyệt thành viên thành công.')}
                          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-[11px] px-3 py-1.5 rounded-lg cursor-pointer"
                        >
                          Duyệt vào CLB
                        </button>
                        <button
                          disabled={isBusy}
                          onClick={() => handleAction(m.id, () => setMemberStatus(m.id, 'REJECTED'), 'Đã từ chối yêu cầu.')}
                          className="bg-surface-2 hover:bg-border disabled:opacity-50 text-rose-400 font-bold text-[11px] px-3 py-1.5 rounded-lg cursor-pointer"
                        >
                          Từ chối
                        </button>
                      </>
                    ) : (
                      <>
                        {myRole === 'OWNER' && (
                          <>
                            <select
                              disabled={isBusy}
                              value={m.role}
                              onChange={(e) => handleAction(m.id, () => setMemberRole(m.id, e.target.value), 'Đã cập nhật vai trò thành viên.')}
                              className="bg-bg border border-border text-xs text-brand font-bold px-2.5 py-1 rounded-lg outline-none cursor-pointer"
                            >
                              <option value="VICE_OWNER">Phó Chủ nhiệm</option>
                              <option value="CONTENT_ADMIN">Quản trị Nội dung</option>
                              <option value="CHALLENGE_ADMIN">Quản trị Thử thách</option>
                              <option value="CAPTAIN">Phó nhóm</option>
                              <option value="MEMBER">Thành viên</option>
                            </select>

                            <button
                              disabled={isBusy}
                              onClick={() => {
                                if (!confirm(`Bạn có chắc chắn muốn trao quyền Chủ nhiệm cho ${displayName}? Bạn sẽ trở thành Phó Chủ nhiệm.`)) return
                                handleAction(m.id, () => transferOwnership(clubId, m.user_id), 'Đã chuyển giao quyền Chủ nhiệm thành công.')
                              }}
                              className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/40 disabled:opacity-50 font-bold text-[11px] px-3 py-1.5 rounded-lg cursor-pointer"
                            >
                              👑 Trao quyền Chủ nhiệm
                            </button>
                          </>
                        )}

                        <button
                          disabled={isBusy}
                          onClick={() => {
                            if (!confirm(`Bạn có chắc chắn muốn mời ${displayName} rời khỏi CLB không?`)) return
                            handleAction(m.id, () => removeMember(m.id), 'Đã gỡ thành viên khỏi CLB.')
                          }}
                          className="bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/60 disabled:opacity-50 text-rose-400 font-bold text-[11px] px-3 py-1.5 rounded-lg cursor-pointer"
                        >
                          Đuổi khỏi CLB
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}