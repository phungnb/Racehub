'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/shared/lib/supabase'

interface ClubDashboardProps {
  profile: any;
  clubId: string;
}

export default function ClubDashboardWithLeaderboard({ profile, clubId }: ClubDashboardProps) {
  const [clubInfo, setClubInfo] = useState<any>(null)
  const [challenges, setChallenges] = useState<any[]>([])
  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(null)
  
  // State cho Bảng xếp hạng (Leaderboard) của thử thách được chọn
  const [leaderboard, setLeaderboard] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // State Modal tạo thử thách nội bộ của CLB
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [objectiveType, setObjectiveType] = useState<'VOLUME' | 'DISTANCE' | 'PERFORMANCE' | 'STREAK'>('VOLUME')
  const [targetVal, setTargetVal] = useState('50') // Km hoặc số ngày
  const [rewardXu, setRewardXu] = useState('100') // Trích từ Quỹ Treasury CLB

  useEffect(() => {
    fetchClubData()
  }, [clubId])

  useEffect(() => {
    if (selectedChallengeId) {
      fetchLeaderboard(selectedChallengeId)
    }
  }, [selectedChallengeId])

  const fetchClubData = async () => {
    setLoading(true)
    // 1. Lấy thông tin CLB & Quỹ Treasury
    const { data: clubData } = await supabase
      .from('clubs')
      .select('*')
      .eq('id', clubId)
      .single()

    if (clubData) setClubInfo(clubData)

    // 2. Lấy danh sách thử thách của CLB này
    const { data: challengeData } = await supabase
      .from('challenges')
      .select('*, challenge_rules(*)')
      .eq('club_id', clubId)
      .order('created_at', { ascending: false })

    if (challengeData && challengeData.length > 0) {
      setChallenges(challengeData)
      setSelectedChallengeId(challengeData[0].id) // Mặc định chọn thử thách đầu tiên để xem BXH
    }
    setLoading(false)
  }

  const fetchLeaderboard = async (challengeId: string) => {
    const { data } = await supabase
      .from('challenge_participants')
      .select(`
        id,
        current_progress,
        score,
        status,
        profiles (id, full_name, avatar_url)
      `)
      .eq('challenge_id', challengeId)
      .order('current_progress', { ascending: false })

    if (data) setLeaderboard(data)
  }

  // HÀNH ĐỘNG CHỦ NHIỆM CLB: Tạo thử thách nội bộ trích từ Quỹ Treasury
  const handleCreateClubChallenge = async (e: React.FormEvent) => {
    e.preventDefault()
    const xuNeeded = parseInt(rewardXu) || 0

    if (clubInfo.treasury_xu < xuNeeded) {
      alert("Quỹ Treasury của CLB không đủ Xu để tài trợ phần thưởng này!")
      return
    }

    // 1. Tạo Challenge với access_type = 'CLUB' và gán club_id
    const { data: newChall, error: challErr } = await supabase.from('challenges').insert({
      title: newTitle.trim() || `Giải nội bộ CLB`,
      objective_type: objectiveType,
      access_type: 'CLUB',
      participation_mode: 'INDIVIDUAL',
      club_id: clubId,
      start_at: new Date().toISOString(),
      end_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      status: 'ACTIVE',
      created_by: profile.id
    }).select().single()

    if (challErr || !newChall) {
      alert("Không thể tạo thử thách nội bộ.")
      return
    }

    // 2. Tạo Rules
    await supabase.from('challenge_rules').insert({
      challenge_id: newChall.id,
      target_value: parseFloat(targetVal) || 50,
      reward_xu: xuNeeded,
      allowed_activity_types: ['RUN']
    })

    // 3. Trừ tiền Quỹ Treasury của CLB và ghi nhận Ledger
    await supabase.from('clubs').update({
      treasury_xu: clubInfo.treasury_xu - xuNeeded
    }).eq('id', clubId)

    await supabase.from('wallet_transactions').insert({
      profile_id: profile.id,
      amount: -xuNeeded,
      transaction_type: 'CLUB_TREASURY_SPONSOR',
      reference_id: newChall.id
    })

    alert("🎉 Ban Chủ Nhiệm đã phát hành giải đấu nội bộ thành công!")
    setShowCreateModal(false)
    setNewTitle('')
    fetchClubData()
  }

  return (
    <div className="space-y-6 animate-fadeIn text-xs">
      
      {/* 1. HEADER & QUỸ TREASURY CLB */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-950 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl">
        <div className="flex justify-between items-start">
          <div>
            <span className="text-[10px] bg-orange-500/20 text-orange-400 px-2.5 py-1 rounded-lg font-bold">VẬN HÀNH CÂU LẠC BỘ</span>
            <h2 className="text-base font-black text-white mt-2">{clubInfo?.name || 'Đang tải...'}</h2>
            <p className="text-slate-400 text-[11px] mt-0.5">Sử dụng RaceHub Engine làm trọng tài chấm điểm tự động cho toàn bộ thành viên.</p>
          </div>
          <div className="bg-slate-950 border border-amber-500/30 px-4 py-2.5 rounded-2xl text-right">
            <span className="text-[9px] text-slate-400 block uppercase tracking-wider">Quỹ Treasury CLB</span>
            <span className="text-sm font-black text-amber-400">🪙 {clubInfo?.treasury_xu || 0} Xu</span>
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t border-slate-800/80">
          <button 
            onClick={() => setShowCreateModal(true)}
            className="bg-orange-500 hover:bg-orange-600 text-slate-950 font-black px-4 py-2.5 rounded-xl transition-all cursor-pointer shadow-lg shadow-orange-500/20"
          >
            🛡️ Chủ Nhiệm: Tạo Thử Thách Mới
          </button>
        </div>
      </div>

      {/* MODAL TẠO THỬ THÁCH NỘI BỘ TRÍCH QUỸ TREASURY */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 w-full max-w-sm space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-orange-400">Phát Hành Giải Đấu Nội Bộ CLB</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 cursor-pointer">✕ Đóng</button>
            </div>

            <form onSubmit={handleCreateClubChallenge} className="space-y-3">
              <div>
                <label className="text-slate-400 block mb-1">Tên giải đấu / Sự kiện</label>
                <input type="text" placeholder="VD: Giải nội bộ tháng 10..." value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white outline-none focus:border-orange-500" required />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Động lực mục tiêu (Objective)</label>
                <select value={objectiveType} onChange={(e) => setObjectiveType(e.target.value as any)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white outline-none">
                  <option value="VOLUME">🎯 Tích lũy tổng Km</option>
                  <option value="DISTANCE">🏁 Chinh phục cự ly chuẩn</option>
                  <option value="PERFORMANCE">⏱️ Thành tích (Sub-Target)</option>
                  <option value="STREAK">🔥 Chuỗi ngày kỷ luật</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Mục tiêu (Km / Ngày)</label>
                  <input type="number" value={targetVal} onChange={(e) => setTargetVal(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white outline-none" required />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Thưởng trích Quỹ (Xu)</label>
                  <input type="number" value={rewardXu} onChange={(e) => setRewardXu(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-amber-400 font-bold outline-none" required />
                </div>
              </div>

              <button type="submit" className="w-full bg-orange-500 hover:bg-orange-600 text-slate-950 font-black py-3 rounded-xl cursor-pointer">
                Xác Nhận Trích Quỹ Phát Hành 🚀
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 2. DANH SÁCH THỬ THÁCH & BẢNG XẾP HẠNG NỘI BỘ (CLUB LEADERBOARD) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        {/* Cột trái: Danh sách các thử thách của CLB */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">🎯 Sự kiện của CLB</h3>
          {challenges.length === 0 ? (
            <div className="bg-slate-900 p-4 rounded-2xl text-slate-500 text-center">Chưa có sự kiện nào.</div>
          ) : (
            challenges.map((c) => (
              <div 
                key={c.id} 
                onClick={() => setSelectedChallengeId(c.id)}
                className={`p-3.5 rounded-2xl border cursor-pointer transition-all ${selectedChallengeId === c.id ? 'bg-orange-500/10 border-orange-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'}`}
              >
                <span className="text-[9px] uppercase font-bold text-orange-400">{c.objective_type}</span>
                <h4 className="font-bold text-xs mt-0.5 text-white">{c.title}</h4>
                <div className="flex justify-between items-center mt-2 text-[10px]">
                  <span className="text-slate-500">Trạng thái: Active</span>
                  <span className="text-amber-400 font-bold">Thưởng Quỹ</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Cột phải: Bảng xếp hạng nội bộ (ClubLeaderboard) cho thử thách được chọn */}
        <div className="md:col-span-2 space-y-3">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">🏆 Bảng Xếp Hạng Nội Bộ CLB (RaceHub Engine)</h3>
          
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
            {leaderboard.length === 0 ? (
              <div className="text-center py-6 text-slate-500">Chưa có thành viên nào tham gia hoặc phát sinh bài chạy hợp lệ.</div>
            ) : (
              <div className="space-y-2">
                {leaderboard.map((item, index) => (
                  <div key={item.id} className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800/60">
                    <div className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center font-black text-[10px] ${index === 0 ? 'bg-amber-500 text-slate-950' : index === 1 ? 'bg-slate-300 text-slate-950' : index === 2 ? 'bg-amber-700 text-white' : 'bg-slate-800 text-slate-400'}`}>
                        {index + 1}
                      </span>
                      <div>
                        <div className="font-bold text-white">{item.profiles?.full_name || 'Runner ẩn danh'}</div>
                        <span className="text-[10px] text-slate-500">Trạng thái: {item.status}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-black text-orange-400">{item.current_progress}</span>
                      <span className="text-[10px] text-slate-500 block">Tiến độ hoàn thành</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  )
}