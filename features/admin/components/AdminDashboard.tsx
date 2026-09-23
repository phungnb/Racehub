'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/shared/lib/supabase'

export default function AdminDashboard({ profile }: { profile: any }) {
  const [pendingActivities, setPendingActivities] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const fetchPendingActivities = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('activities')
      .select('*, profiles(display_name)')
      .eq('validation_status', 'PENDING')
      .order('created_at', { ascending: false })

    if (data) setPendingActivities(data)
    setLoading(false)
  }

  useEffect(() => {
    fetchPendingActivities()
  }, [])

  const handleValidateActivity = async (activityId: string, status: 'APPROVED' | 'REJECTED') => {
    // Duyệt qua RPC: máy chủ kiểm tra quyền admin và ghi nhật ký
    const { error } = await supabase.rpc('review_activity', {
      p_activity_id: activityId,
      p_decision: status,
    })

    if (!error) {
      setPendingActivities(prev => prev.filter(item => item.id !== activityId))
    } else {
      alert('Lỗi cập nhật trạng thái hoạt động!')
    }
  }

  // Kiểm tra quyền truy cập (Chỉ SYSTEM_ADMIN hoặc CLUB_ADMIN mới được vào)
  if (profile?.role !== 'SYSTEM_ADMIN' && profile?.role !== 'CLUB_ADMIN') {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-2">
        <span className="text-2xl">🔒</span>
        <h3 className="text-sm font-bold text-red-400">Truy cập bị từ chối</h3>
        <p className="text-xs text-slate-400">Bạn không có quyền quản trị viên (Admin) để xem khu vực này.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-sm font-black text-orange-500 uppercase tracking-wider">Khu vực Quản trị & Duyệt Bài</h2>
          <span className="text-[10px] bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full font-bold">
            {profile.role}
          </span>
        </div>

        <p className="text-xs text-slate-400">Duyệt các hoạt động chạy của thành viên để cộng điểm XP và tích lũy vào hệ thống giải đấu.</p>

        {loading ? (
          <div className="text-center py-6 text-xs text-slate-500">Đang tải danh sách chờ duyệt...</div>
        ) : pendingActivities.length === 0 ? (
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-center text-xs text-slate-500">
            Không có hoạt động nào đang chờ duyệt.
          </div>
        ) : (
          <div className="space-y-3">
            {pendingActivities.map((act) => (
              <div key={act.id} className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="text-xs font-bold text-white">{act.title || 'Buổi chạy training'}</h4>
                    <p className="text-[11px] text-slate-400">Runner: <span className="text-orange-400 font-semibold">{act.profiles?.display_name || 'Thành viên'}</span></p>
                  </div>
                  <span className="text-xs font-black text-amber-400">{(act.distance_m / 1000).toFixed(2)} km</span>
                </div>

                <div className="flex gap-2 pt-2">
                  <button 
                    onClick={() => handleValidateActivity(act.id, 'APPROVED')}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2 rounded-lg transition-colors cursor-pointer"
                  >
                    DUYỆT ✓
                  </button>
                  <button 
                    onClick={() => handleValidateActivity(act.id, 'REJECTED')}
                    className="flex-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 text-xs font-bold py-2 rounded-lg transition-colors cursor-pointer"
                  >
                    TỪ CHỐI ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}