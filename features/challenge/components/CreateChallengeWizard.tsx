'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

interface CreateChallengeWizardProps {
  profile: any;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateChallengeWizard({ profile, onClose, onCreated }: CreateChallengeWizardProps) {
  const [step, setStep] = useState(1)

  // LỚP 1: OBJECTIVE (4 nhóm chuẩn kiến trúc RaceHub)
  const [objectiveType, setObjectiveType] = useState<'VOLUME' | 'DISTANCE' | 'PERFORMANCE' | 'STREAK'>('VOLUME')
  const [title, setTitle] = useState('')
  
  // Dữ liệu cho TÍCH LŨY (Volume)
  const [targetDistanceKm, setTargetDistanceKm] = useState('100')
  const [targetDays, setTargetDays] = useState('30')

  // Dữ liệu cho CHINH PHỤC CỰ LY & THÀNH TÍCH
  const [selectedPresetDistance, setSelectedPresetDistance] = useState('21.1')
  const [customDistanceKm, setCustomDistanceKm] = useState('15')
  const [allowExceedDistance, setAllowExceedDistance] = useState(true) // Cho phép vượt cự ly

  // Dữ liệu cho THÀNH TÍCH (Performance)
  const [cutoffTimeHours, setCutoffTimeHours] = useState('2')
  const [cutoffTimeMinutes, setCutoffTimeMinutes] = useState('10')
  const [perfTimeMetric, setPerfTimeMetric] = useState<'MOVING_TIME' | 'ELAPSED_TIME'>('MOVING_TIME')

  // Dữ liệu cho CHUỖI NGÀY (Streak) - Đã sửa lỗi thiếu state
  const [streakDaysCount, setStreakDaysCount] = useState('7')
  const [streakMinKmPerDay, setStreakMinKmPerDay] = useState('3')

  // LỚP 2: CONDITION
  const [minDistKm, setMinDistKm] = useState('1')
  const [requireHeartRate, setRequireHeartRate] = useState(false)

  // LỚP 3: TIME
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [regDeadline, setRegDeadline] = useState('')

  // LỚP 4: PARTICIPATION
  const [accessType, setAccessType] = useState<'PUBLIC' | 'PRIVATE' | 'CLUB'>('PUBLIC')
  const [participationMode, setParticipationMode] = useState<'INDIVIDUAL' | 'COMPETITIVE' | 'TEAM'>('INDIVIDUAL')
  const [inviteTarget, setInviteTarget] = useState('')

  // LỚP 5: REWARD & LEDGER
  const [wagerXu, setWagerXu] = useState('0')
  const [rewardXp, setRewardXp] = useState('500')

  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleCompleteCreation = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    const xuAmount = parseInt(wagerXu) || 0
    if (xuAmount > 0 && participationMode === 'COMPETITIVE' && profile.xu < xuAmount) {
      alert("Ví cá nhân không đủ Xu để ký quỹ cho kèo đấu này!")
      setIsSubmitting(false)
      return
    }

    // Lấy giá trị cự ly thực tế nếu dùng preset hay custom
    const finalDistance = selectedPresetDistance === 'CUSTOM' ? parseFloat(customDistanceKm) : parseFloat(selectedPresetDistance)

    const { data: challengeData, error: challengeError } = await supabase.from('challenges').insert({
      title: title.trim() || `Thử thách ${objectiveType}`,
      objective_type: objectiveType,
      start_at: startDate ? new Date(startDate).toISOString() : new Date().toISOString(),
      end_at: endDate ? new Date(endDate).toISOString() : new Date(Date.now() + 30*86400000).toISOString(),
      registration_deadline: regDeadline ? new Date(regDeadline).toISOString() : null,
      access_type: accessType,
      participation_mode: participationMode,
      status: 'ACTIVE',
      created_by: profile.id
    }).select().single()

    if (challengeError || !challengeData) {
      alert("Không thể khởi tạo thử thách. Vui lòng thử lại.")
      setIsSubmitting(false)
      return
    }

    const challengeId = challengeData.id
    const targetVal = objectiveType === 'VOLUME' ? parseFloat(targetDistanceKm) : objectiveType === 'STREAK' ? parseInt(streakDaysCount) : finalDistance
    const cutoffSec = objectiveType === 'PERFORMANCE' ? (parseInt(cutoffTimeHours) || 0) * 3600 + (parseInt(cutoffTimeMinutes) || 0) * 60 : null

    await supabase.from('challenge_rules').insert({
      challenge_id: challengeId,
      target_distance_m: (objectiveType === 'DISTANCE' || objectiveType === 'PERFORMANCE') ? finalDistance * 1000 : objectiveType === 'VOLUME' ? parseFloat(targetDistanceKm) * 1000 : null,
      target_value: targetVal,
      minimum_distance_m: parseFloat(minDistKm) * 1000,
      time_metric: perfTimeMetric,
      cutoff_time_s: cutoffSec,
      require_heart_rate: requireHeartRate,
      allowed_activity_types: ['RUN'],
      scoring_type: 'XP',
      reward_xu: xuAmount
    })

    if (xuAmount > 0 && participationMode === 'COMPETITIVE') {
      await supabase.from('wallet_transactions').insert({
        profile_id: profile.id,
        amount: -xuAmount,
        transaction_type: 'CHALLENGE_WAGER',
        reference_id: challengeId
      })
      await supabase.from('profiles').update({ xu: profile.xu - xuAmount }).eq('id', profile.id)
    }

    setIsSubmitting(false)
    alert("🎉 Khởi tạo thử thách chuẩn kiến trúc RaceHub thành công!")
    onCreated()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 w-full max-w-md space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto text-xs">
        
        {/* HEADER & STEP INDICATOR */}
        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-orange-400">Tạo Thử Thách Chuẩn RaceHub</h3>
            <span className="text-[10px] text-slate-400">Bước {step} / 5: {
              step === 1 ? 'Chọn Mục Tiêu (Objective)' :
              step === 2 ? 'Cấu Hình Điều Kiện (Condition)' :
              step === 3 ? 'Thời Gian (Time Engine)' :
              step === 4 ? 'Hình Thức & Tham Gia (Participation)' : 'Phần Thưởng & Ký Quỹ (Reward & Ledger)'
            }</span>
          </div>
          <button onClick={onClose} className="text-slate-400 text-xs cursor-pointer">✕ Đóng</button>
        </div>

        {/* --- STEP 1: OBJECTIVE CHUẨN 4 NHÓM --- */}
        {step === 1 && (
          <div className="space-y-3">
            <label className="text-slate-300 font-bold block">1. Lựa chọn 1 trong 4 Động Lực (Objective)</label>
            
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setObjectiveType('VOLUME')} className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${objectiveType === 'VOLUME' ? 'bg-orange-500/10 border-orange-500 text-orange-400' : 'bg-slate-950 border-slate-800 text-slate-300'}`}>
                <div className="font-bold">🎯 TÍCH LŨY</div>
                <div className="text-[10px] text-slate-400 mt-1">Cộng tổng qua nhiều bài chạy.</div>
              </button>
              <button type="button" onClick={() => setObjectiveType('DISTANCE')} className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${objectiveType === 'DISTANCE' ? 'bg-orange-500/10 border-orange-500 text-orange-400' : 'bg-slate-950 border-slate-800 text-slate-300'}`}>
                <div className="font-bold">🏁 CHINH PHỤC CỰ LY</div>
                <div className="text-[10px] text-slate-400 mt-1">1 bài chạy đạt cự ly mục tiêu.</div>
              </button>
              <button type="button" onClick={() => setObjectiveType('PERFORMANCE')} className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${objectiveType === 'PERFORMANCE' ? 'bg-orange-500/10 border-orange-500 text-orange-400' : 'bg-slate-950 border-slate-800 text-slate-300'}`}>
                <div className="font-bold">⏱️ THÀNH TÍCH</div>
                <div className="text-[10px] text-slate-400 mt-1">1 bài chạy đạt cự ly + Cut-off.</div>
              </button>
              <button type="button" onClick={() => setObjectiveType('STREAK')} className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${objectiveType === 'STREAK' ? 'bg-orange-500/10 border-orange-500 text-orange-400' : 'bg-slate-950 border-slate-800 text-slate-300'}`}>
                <div className="font-bold">🔥 CHUỖI NGÀY</div>
                <div className="text-[10px] text-slate-400 mt-1">Kỷ luật liên tục X ngày.</div>
              </button>
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Tên Thử Thách</label>
              <input type="text" placeholder="VD: Thử thách tháng 10, Chinh phục HM Sub 2..." value={title} onChange={(e) => setTitle(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white outline-none focus:border-orange-500" />
            </div>

            {/* A. TÍCH LŨY */}
            {objectiveType === 'VOLUME' && (
              <div className="space-y-2 bg-slate-950 p-3 rounded-2xl border border-slate-800">
                <span className="text-[10px] font-bold text-orange-400 block">🎯 Cấu hình Tích Lũy</span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-slate-400 block mb-1">Mục tiêu (Km)</label>
                    <input type="number" value={targetDistanceKm} onChange={(e) => setTargetDistanceKm(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-white outline-none focus:border-orange-500" />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Thời gian (Ngày)</label>
                    <input type="number" value={targetDays} onChange={(e) => setTargetDays(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-white outline-none focus:border-orange-500" />
                  </div>
                </div>
              </div>
            )}

            {/* B. CHINH PHỤC CỰ LY */}
            {objectiveType === 'DISTANCE' && (
              <div className="space-y-2 bg-slate-950 p-3 rounded-2xl border border-slate-800">
                <span className="text-[10px] font-bold text-orange-400 block">🏁 Cấu hình Chinh Phục Cự Ly</span>
                <div>
                  <label className="text-slate-400 block mb-1">Cự ly mục tiêu</label>
                  <select value={selectedPresetDistance} onChange={(e) => setSelectedPresetDistance(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white outline-none focus:border-orange-500">
                    <option value="3">3K</option>
                    <option value="5">5K</option>
                    <option value="10">10K</option>
                    <option value="15">15K</option>
                    <option value="21.1">HM — 21.1K (Half Marathon)</option>
                    <option value="30">30K</option>
                    <option value="42.2">FM — 42.2K (Full Marathon)</option>
                    <option value="50">Ultra 50K</option>
                    <option value="100">Ultra 100K</option>
                    <option value="CUSTOM">⚙ Cự ly tùy chỉnh...</option>
                  </select>
                </div>

                {selectedPresetDistance === 'CUSTOM' && (
                  <div>
                    <label className="text-slate-400 block mb-1">Nhập cự ly tùy chỉnh (Km)</label>
                    <input type="number" step="0.5" value={customDistanceKm} onChange={(e) => setCustomDistanceKm(e.target.value)} className="w-full bg-slate-900 border border-orange-500/50 rounded-xl p-2 text-orange-400 font-bold outline-none" />
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <input type="checkbox" id="exceedCheck" checked={allowExceedDistance} onChange={(e) => setAllowExceedDistance(e.target.checked)} className="rounded bg-slate-900 border-slate-800 text-orange-500" />
                  <label htmlFor="exceedCheck" className="text-slate-300 text-[11px]">Cho phép vượt cự ly mục tiêu vẫn tính đạt</label>
                </div>
              </div>
            )}

            {/* C. THÀNH TÍCH */}
            {objectiveType === 'PERFORMANCE' && (
              <div className="space-y-2 bg-slate-950 p-3 rounded-2xl border border-slate-800">
                <span className="text-[10px] font-bold text-orange-400 block">⏱️ Cấu hình Thành Tích (Sub-Target)</span>
                <div>
                  <label className="text-slate-400 block mb-1">Cự ly áp dụng</label>
                  <select value={selectedPresetDistance} onChange={(e) => setSelectedPresetDistance(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white outline-none focus:border-orange-500">
                    <option value="5">5K</option>
                    <option value="10">10K</option>
                    <option value="21.1">HM — 21.1K</option>
                    <option value="42.2">FM — 42.2K</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Cut-off Time (Giới hạn thời gian)</label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-xl p-2">
                      <input type="number" value={cutoffTimeHours} onChange={(e) => setCutoffTimeHours(e.target.value)} className="w-full bg-transparent text-white font-bold outline-none text-center" />
                      <span className="text-slate-500">Giờ</span>
                    </div>
                    <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-xl p-2">
                      <input type="number" value={cutoffTimeMinutes} onChange={(e) => setCutoffTimeMinutes(e.target.value)} className="w-full bg-transparent text-white font-bold outline-none text-center" />
                      <span className="text-slate-500">Phút</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Tính theo tiêu chuẩn</label>
                  <div className="flex gap-4 pt-1">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="timeMetric" checked={perfTimeMetric === 'MOVING_TIME'} onChange={() => setPerfTimeMetric('MOVING_TIME')} className="text-orange-500" />
                      <span>Moving Time</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="timeMetric" checked={perfTimeMetric === 'ELAPSED_TIME'} onChange={() => setPerfTimeMetric('ELAPSED_TIME')} className="text-orange-500" />
                      <span>Elapsed Time</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* D. CHUỖI NGÀY */}
            {objectiveType === 'STREAK' && (
              <div className="space-y-2 bg-slate-950 p-3 rounded-2xl border border-slate-800">
                <span className="text-[10px] font-bold text-orange-400 block">🔥 Cấu hình Chuỗi Kỷ Luật</span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-slate-400 block mb-1">Số ngày (X)</label>
                    <input type="number" value={streakDaysCount} onChange={(e) => setStreakDaysCount(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-white outline-none focus:border-orange-500" />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Tối thiểu mỗi ngày (Km)</label>
                    <input type="number" step="0.5" value={streakMinKmPerDay} onChange={(e) => setStreakMinKmPerDay(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-orange-400 font-bold outline-none focus:border-orange-500" />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* --- STEP 2: CONDITION --- */}
        {step === 2 && (
          <div className="space-y-3">
            <label className="text-slate-300 font-bold block">2. Cấu hình Điều Kiện Hợp Lệ (Condition Engine)</label>
            <div>
              <label className="text-slate-400 block mb-1">Cự ly tối thiểu tính bài chạy (Km)</label>
              <input type="number" step="0.5" value={minDistKm} onChange={(e) => setMinDistKm(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white outline-none focus:border-orange-500" />
            </div>
            <div className="flex items-center gap-2 pt-2">
              <input type="checkbox" id="hrCheck" checked={requireHeartRate} onChange={(e) => setRequireHeartRate(e.target.checked)} className="rounded bg-slate-950 border-slate-800 text-orange-500" />
              <label htmlFor="hrCheck" className="text-slate-300">Bắt buộc phải có dữ liệu Nhịp tim (Heart Rate)</label>
            </div>
          </div>
        )}

        {/* --- STEP 3: TIME --- */}
        {step === 3 && (
          <div className="space-y-3">
            <label className="text-slate-300 font-bold block">3. Thiết lập Thời Gian (Time Engine)</label>
            <div>
              <label className="text-slate-400 block mb-1">Hạn chót đăng ký</label>
              <input type="datetime-local" value={regDeadline} onChange={(e) => setRegDeadline(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white outline-none focus:border-orange-500" />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Bắt đầu tính thử thách</label>
              <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white outline-none focus:border-orange-500" />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Kết thúc thử thách</label>
              <input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white outline-none focus:border-orange-500" />
            </div>
          </div>
        )}

        {/* --- STEP 4: PARTICIPATION --- */}
        {step === 4 && (
          <div className="space-y-3">
            <label className="text-slate-300 font-bold block">4. Quyền Truy Cập & Hình Thức Tham Gia</label>
            <div>
              <label className="text-slate-400 block mb-1">Phạm vi tiếp cận (Access Type)</label>
              <select value={accessType} onChange={(e) => setAccessType(e.target.value as any)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white outline-none focus:border-orange-500">
                <option value="PUBLIC">🌐 Công khai (Mọi người cùng tham gia)</option>
                <option value="PRIVATE">🔒 Riêng tư / Mời trực tiếp</option>
                <option value="CLUB">🛡️ Độc quyền Câu lạc bộ</option>
              </select>
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Cơ chế thi đấu (Participation Mode)</label>
              <select value={participationMode} onChange={(e) => setParticipationMode(e.target.value as any)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white outline-none focus:border-orange-500">
                <option value="INDIVIDUAL">👤 Cá nhân / Tự lập mục tiêu</option>
                <option value="COMPETITIVE">⚡ Thi đấu đối kháng 1v1 (Solo Escrow)</option>
                <option value="TEAM">🤝 Đồng đội / Đội nhóm CLB</option>
              </select>
            </div>
          </div>
        )}

        {/* --- STEP 5: REWARD & LEDGER --- */}
        {step === 5 && (
          <div className="space-y-3">
            <label className="text-slate-300 font-bold block">5. Phần Thưởng & Ký Quỹ (Ledger System)</label>
            {participationMode === 'COMPETITIVE' && (
              <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-xl space-y-1">
                <span className="text-amber-400 font-bold block">🪙 Ký quỹ cược Xu (Escrow Wager)</span>
                <p className="text-[10px] text-slate-300">Ghi sổ qua Wallet Ledger an toàn.</p>
                <input type="number" value={wagerXu} onChange={(e) => setWagerXu(e.target.value)} className="w-full bg-slate-950 border border-amber-500/40 rounded-xl p-2 text-amber-400 font-bold mt-2" />
              </div>
            )}
            <div>
              <label className="text-slate-400 block mb-1">Điểm kinh nghiệm thưởng (XP)</label>
              <input type="number" value={rewardXp} onChange={(e) => setRewardXp(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white outline-none focus:border-orange-500" />
            </div>
          </div>
        )}

        {/* NAVIGATION BUTTONS */}
        <div className="flex gap-2 pt-3 border-t border-slate-800">
          {step > 1 && (
            <button type="button" onClick={() => setStep(step - 1)} className="w-1/3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl cursor-pointer">
              Quay lại
            </button>
          )}
          {step < 5 ? (
            <button type="button" onClick={() => setStep(step + 1)} className="w-full bg-orange-500 hover:bg-orange-600 text-slate-950 font-black py-2.5 rounded-xl cursor-pointer shadow-lg shadow-orange-500/20">
              Tiếp theo ➔
            </button>
          ) : (
            <button type="button" disabled={isSubmitting} onClick={handleCompleteCreation} className="w-full bg-orange-500 hover:bg-orange-600 text-slate-950 font-black py-2.5 rounded-xl cursor-pointer shadow-lg shadow-orange-500/20">
              {isSubmitting ? 'Đang khởi tạo...' : '🚀 Hoàn Tất & Phát Hành'}
            </button>
          )}
        </div>

      </div>
    </div>
  )
}