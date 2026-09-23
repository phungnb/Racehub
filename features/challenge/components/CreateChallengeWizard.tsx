'./use client';

import { useState } from 'react';
import { Trophy, Users, AlertTriangle, X } from 'lucide-react';
import { createChallengeInSupabase } from '../api/challengeApi';

interface CreateChallengeWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
  profile?: any;
}

export default function CreateChallengeWizard({ isOpen, onClose, onCreated, profile }: CreateChallengeWizardProps) {
  const [challengeType, setChallengeType] = useState<'INDIVIDUAL' | 'TEAM'>('INDIVIDUAL');
  const [gameMode, setGameMode] = useState<'TEAM_SUM' | 'TEAM_AVG' | 'TEAM_GAP' | 'LAST_MEMBER'>('TEAM_SUM');
  const [maxSlots, setMaxSlots] = useState<number>(50);
  
  const [title, setTitle] = useState('');
  const [minKm, setMinKm] = useState(2.0);
  const [minMembers, setMinMembers] = useState(5);
  const [minPace, setMinPace] = useState(3.0);
  const [maxPace, setMaxPace] = useState(12.0);

  const [todayStr] = useState(() => new Date().toISOString().split('T')[0]);
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(() => new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0]);
  const [regDeadline, setRegDeadline] = useState(todayStr);

  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  if (!isOpen) return null;

  const estimatedFee = maxSlots <= 10 ? 20 : maxSlots <= 50 ? 50 : 150;
  const userXu = profile?.xu || 0;
  const hasEnoughXu = userXu >= estimatedFee;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText(null);

    const regDate = new Date(regDeadline);
    const startD = new Date(startDate);
    const endD = new Date(endDate);
    const nowD = new Date(todayStr);

    if (regDate < nowD) {
      setErrorText('Hạn đăng ký không được trong quá khứ.');
      return;
    }
    if (regDate > startD) {
      setErrorText('Hạn đăng ký phải trước hoặc bằng ngày bắt đầu giải đấu.');
      return;
    }
    if (startD >= endD) {
      setErrorText('Ngày bắt đầu phải trước ngày kết thúc.');
      return;
    }
    if (minPace >= maxPace) {
      setErrorText('Min Pace phải nhỏ hơn Max Pace.');
      return;
    }

    if (!hasEnoughXu) {
      setErrorText(`Số dư không đủ. Ước tính cần ${estimatedFee} Xu nhưng ví chỉ có ${userXu} Xu.`);
      return;
    }

    setLoading(true);

    try {
      const payload = {
        title,
        challenge_type: challengeType,
        game_mode: challengeType === 'INDIVIDUAL' ? 'ACCUMULATE' : gameMode,
        target_km: 100,
        min_km: minKm,
        min_members: challengeType === 'TEAM' ? minMembers : 1,
        fixed_team_size: 5,
        target_audience: 'PUBLIC' as const,
        max_slots: maxSlots,
        start_date: new Date(startDate).toISOString(),
        end_date: new Date(endDate).toISOString(),
        reg_deadline: new Date(regDeadline).toISOString(),
        min_pace: minPace,
        max_pace: maxPace,
        created_by: profile?.id || null,
      };

      await createChallengeInSupabase(payload);
      alert('Khởi tạo thử thách và ghi sổ cái thành công!');
      if (onCreated) onCreated();
      onClose();
    } catch (err: any) {
      setErrorText(err.message || 'Đã có lỗi xảy ra.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
      <div className="bg-[#18191a] border border-[#2f3031] w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden text-white">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2f3031] bg-[#242526]">
          <div className="flex items-center space-x-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            <h2 className="text-sm font-bold">Tạo Thử Thách Chuẩn Sổ Cái</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto text-xs">
          
          {errorText && (
            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 p-3 rounded-xl flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{errorText}</span>
            </div>
          )}

          {/* Quy mô & Phí dự kiến */}
          <div className="grid grid-cols-2 gap-3 bg-[#242526] p-3 rounded-2xl border border-[#3a3b3c]">
            <div>
              <label className="block text-[10px] font-semibold text-amber-400 mb-1">Quy Mô / Giới Hạn VĐV</label>
              <select 
                value={maxSlots}
                onChange={(e) => setMaxSlots(parseInt(e.target.value, 10))}
                className="w-full bg-[#18191a] border border-[#3a3b3c] rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
              >
                <option value={10}>👤 Kèo Solo (&lt;= 10 VĐV)</option>
                <option value={50}>🛡️ Kèo CLB (&lt;= 50 VĐV)</option>
                <option value={200}>🏆 Kèo Đại Hội (&gt; 50 VĐV)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 mb-1">Phí Dự Kiến (Sổ Cái)</label>
              <div className="w-full bg-[#18191a] border border-[#3a3b3c] rounded-xl px-2.5 py-2 text-xs text-amber-400 font-bold flex items-center justify-between">
                <span>🪙 ~{estimatedFee} Xu</span>
                <span className="text-[10px] text-gray-400">(Ví: {userXu} Xu)</span>
              </div>
            </div>
          </div>

          {/* 1. Phân Loại Thử Thách */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 mb-1.5">1. Phân Loại Thử Thách</label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setChallengeType('INDIVIDUAL')}
                className={`py-3 px-4 rounded-2xl border text-xs font-bold transition-all cursor-pointer ${
                  challengeType === 'INDIVIDUAL' 
                    ? 'bg-amber-500/10 border-amber-500 text-amber-400 shadow-md' 
                    : 'bg-[#242526] border-[#3a3b3c] text-gray-400 hover:text-white'
                }`}
              >
                Cá Nhân (Individual)
              </button>
              <button
                type="button"
                onClick={() => setChallengeType('TEAM')}
                className={`py-3 px-4 rounded-2xl border text-xs font-bold transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
                  challengeType === 'TEAM' 
                    ? 'bg-amber-500/10 border-amber-500 text-amber-400 shadow-md' 
                    : 'bg-[#242526] border-[#3a3b3c] text-gray-400 hover:text-white'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Đồng Đội (Team)</span>
              </button>
            </div>
          </div>

          {/* Cấu hình riêng khi chọn ĐỒNG ĐỘI */}
          {challengeType === 'TEAM' && (
            <div className="bg-amber-500/5 border border-amber-500/20 p-3 rounded-2xl space-y-3 animate-fadeIn">
              <div>
                <label className="block text-[10px] font-semibold text-amber-400 mb-1">Thể Thức Đồng Đội (Game Mode)</label>
                <select 
                  value={gameMode}
                  onChange={(e) => setGameMode(e.target.value as any)}
                  className="w-full bg-[#18191a] border border-[#3a3b3c] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 font-bold"
                >
                  <option value="TEAM_SUM">Cộng Dồn Toàn Đội (Team Sum)</option>
                  <option value="TEAM_AVG">Trung Bình Đội (Team Average)</option>
                  <option value="TEAM_GAP">Khoảng Cách Nội Bộ (Team Gap)</option>
                  <option value="LAST_MEMBER">Chốt Đoàn / VĐV Yếu Nhất (Last Member)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 mb-1">Số Thành Viên Tối Thiểu / Đội</label>
                <input 
                  type="number" 
                  min="2"
                  value={minMembers}
                  onChange={(e) => setMinMembers(parseInt(e.target.value, 10))}
                  className="w-full bg-[#18191a] border border-[#3a3b3c] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 font-bold"
                />
              </div>
            </div>
          )}

          {/* Tên Thử Thách */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 mb-1">Tên Thử Thách</label>
            <input 
              type="text" 
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Tranh Cup Mùa Hè..."
              className="w-full bg-[#242526] border border-[#3a3b3c] rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Ngày tháng */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 mb-1">Hạn Đăng Ký</label>
              <input type="date" value={regDeadline} onChange={(e) => setRegDeadline(e.target.value)} className="w-full bg-[#242526] border border-[#3a3b3c] rounded-xl px-2 py-2 text-[11px] text-white" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 mb-1">Ngày Bắt Đầu</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full bg-[#242526] border border-[#3a3b3c] rounded-xl px-2 py-2 text-[11px] text-white" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 mb-1">Ngày Kết Thúc</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full bg-[#242526] border border-[#3a3b3c] rounded-xl px-2 py-2 text-[11px] text-white" />
            </div>
          </div>

          {/* Cự ly & Pace */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 mb-1">Cự ly tối thiểu (Km)</label>
              <input type="number" step="0.1" value={minKm} onChange={(e) => setMinKm(parseFloat(e.target.value))} className="w-full bg-[#242526] border border-[#3a3b3c] rounded-xl px-2 py-2 text-xs text-white" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 mb-1">Min Pace (phút/km)</label>
              <input type="number" step="0.1" value={minPace} onChange={(e) => setMinPace(parseFloat(e.target.value))} className="w-full bg-[#242526] border border-[#3a3b3c] rounded-xl px-2 py-2 text-xs text-white" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 mb-1">Max Pace (phút/km)</label>
              <input type="number" step="0.1" value={maxPace} onChange={(e) => setMaxPace(parseFloat(e.target.value))} className="w-full bg-[#242526] border border-[#3a3b3c] rounded-xl px-2 py-2 text-xs text-white" />
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-between pt-3 border-t border-[#2f3031]">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-white cursor-pointer">Hủy bỏ</button>
            <button 
              type="submit" 
              disabled={loading} 
              className={`px-5 py-2.5 rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer ${
                hasEnoughXu 
                  ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white hover:opacity-95' 
                  : 'bg-gray-700 text-gray-400 opacity-70 cursor-not-allowed'
              }`}
            >
              {loading ? 'Đang xử lý sổ cái...' : `Khởi Tạo Thử Thách (~${estimatedFee} Xu)`}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
