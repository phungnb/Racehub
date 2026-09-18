'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function ClubAdminPanel({ profile }: { profile: any }) {
  const [pendingMembers, setPendingMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchPendingMembers()
  }, [])

  // Lấy danh sách thành viên xin gia nhập CLB đang chờ duyệt
  const fetchPendingMembers = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('club_members')
      .select('*, profiles(display_name), clubs(name)')
      .eq('status', 'PENDING') // Trạng thái chờ duyệt vào CLB

    if (data) setPendingMembers(data)
    setLoading(false)
  }

  // Duyệt hoặc từ chối thành viên vào CLB
  const handleApproveMember = async (memberId: string, approved: boolean) => {
    const { error } = await supabase
      .from('club_members')
      .update({ status: approved ? 'ACTIVE' : 'REJECTED', role: 'MEMBER' })
      .eq('id', memberId)

    if (!error) {
      setPendingMembers(prev => prev.filter(m => m.id !== memberId))
      alert(approved ? 'Đã duyệt thành viên vào câu lạc bộ!' : 'Đã từ chối yêu cầu.')
    } else {
      alert('Lỗi thao tác với thành viên.')
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-black text-orange-500 uppercase tracking-wider">🛡️ Quản trị Câu lạc bộ (Trưởng/Phó nhóm)</h2>
        <span className="text-[10px] bg-orange-500/20 text-orange-400 px-2.5 py-0.5 rounded-full font-bold">
          CLUB ADMIN
        </span>
      </div>

      <p className="text-xs text-slate-400">
        Quản lý yêu cầu tham gia câu lạc bộ, phân quyền phó nhóm và theo dõi thành viên nội bộ (tương tự quản lý nhóm Zalo).
      </p>

      {/* Danh sách thành viên chờ duyệt */}
      <div className="space-y-3 pt-2">
        <h3 className="text-xs font-bold text-slate-300">Yêu cầu gia nhập chờ duyệt ({pendingMembers.length})</h3>
        
        {loading ? (
          <div className="text-center py-4 text-xs text-slate-500">Đang tải danh sách chờ...</div>
        ) : pendingMembers.length === 0 ? (
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-center text-xs text-slate-500">
            Không có yêu cầu gia nhập mới nào đang chờ.
          </div>
        ) : (
          pendingMembers.map((m) => (
            <div key={m.id} className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex justify-between items-center">
              <div>
                <h4 className="text-xs font-bold text-white">{m.profiles?.display_name || 'Runner'}</h4>
                <p className="text-[10px] text-slate-400">Xin vào CLB: <span className="text-orange-400">{m.clubs?.name || 'Câu lạc bộ'}</span></p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => handleApproveMember(m.id, true)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg cursor-pointer"
                >
                  DUYỆT ✓
                </button>
                <button 
                  onClick={() => handleApproveMember(m.id, false)}
                  className="bg-red-600/20 text-red-400 hover:bg-red-600/30 text-[10px] font-bold px-3 py-1.5 rounded-lg border border-red-500/30 cursor-pointer"
                >
                  TỪ CHỐI
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}