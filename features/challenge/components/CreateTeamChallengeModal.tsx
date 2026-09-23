'use client';

import React, { useState } from 'react';
import { Users, Trophy, Flame, ShieldAlert, CheckCircle2 } from 'lucide-react';

export default function CreateTeamChallengeModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [gameMode, setGameMode] = useState<'TEAM_SUM' | 'TEAM_AVG' | 'TEAM_GAP' | 'LAST_MEMBER'>('TEAM_SUM');
  const [scoreType, setScoreType] = useState<'DISTANCE' | 'TIME'>('DISTANCE');
  const [title, setTitle] = useState('');
  const [minKm, setMinKm] = useState(2.0);
  const [minMembers, setMinMembers] = useState(5);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Gọi API lưu cấu hình Thử thách đồng đội vào Supabase
    try {
      console.log({ title, gameMode, scoreType, minKm, minMembers });
      // Giả lập lưu thành công
      setTimeout(() => {
        setLoading(false);
        onClose();
      }, 1000);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-surface border border-border w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden text-white">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface-2">
          <div className="flex items-center space-x-2">
            <Trophy className="w-6 h-6 text-amber-500" />
            <h2 className="text-lg font-bold">Tạo Thử Thách Đồng Đội (Team Challenge)</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl font-bold">&times;</button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          
          {/* Tên Thử Thách */}
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">Tên Thử Thách</label>
            <input 
              type="text" 
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Giải Đua Câu Lạc Bộ Mùa Hè - Tranh Cup Vô Địch"
              className="w-full bg-surface-2 border border-[#3a3b3c] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>

          {/* Chọn Game Mode Đồng Đội */}
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">Thể Thức Thi Đấu (Game Mode)</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { id: 'TEAM_SUM', label: 'Cộng Dồn Toàn Đội', desc: 'Tổng cự ly tất cả thành viên gom lại' },
                { id: 'TEAM_AVG', label: 'Trung Bình Đội', desc: 'Điểm chia theo tổng số quân / active' },
                { id: 'TEAM_GAP', label: 'Khoảng Cách (Gap)', desc: 'Chiến thuật bám đuổi khoảng cách nội bộ' },
                { id: 'LAST_MEMBER', label: 'Chốt Đoàn (Last Member)', desc: 'Tính thành tích theo VĐV yếu nhất' },
              ].map((mode) => (
                <div 
                  key={mode.id}
                  onClick={() => setGameMode(mode.id as any)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    gameMode === mode.id 
                      ? 'bg-amber-500/10 border-amber-500 text-amber-400' 
                      : 'bg-surface-2 border-[#3a3b3c] text-gray-300 hover:border-gray-500'
                  }`}
                >
                  <div className="font-bold text-sm">{mode.label}</div>
                  <div className="text-xs text-gray-400 mt-1">{mode.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Tiêu chí phụ & Ràng buộc */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">Cự ly tối thiểu tính bài (Km)</label>
              <input 
                type="number" 
                step="0.1"
                value={minKm}
                onChange={(e) => setMinKm(parseFloat(e.target.value))}
                className="w-full bg-surface-2 border border-[#3a3b3c] rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">Số TV tối thiểu hợp lệ (Min TV)</label>
              <input 
                type="number" 
                value={minMembers}
                onChange={(e) => setMinMembers(parseInt(e.target.value))}
                className="w-full bg-surface-2 border border-[#3a3b3c] rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {/* Chú ý nguyên tắc */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 flex items-start space-x-3 text-xs text-blue-300">
            <ShieldAlert className="w-5 h-5 flex-shrink-0 text-blue-400 mt-0.5" />
            <div>
              <span className="font-bold">Nguyên tắc vận hành:</span> Admin/Owner có quyền khởi tạo và phân chia đội hình, tuy nhiên hệ thống <strong className="text-white">Challenge Engine</strong> sẽ tự động tính toán điểm số và xếp hạng minh bạch, tuyệt đối không can thiệp thủ công vào kết quả.
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-border">
            <button 
              type="button" 
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-gray-400 hover:text-white hover:bg-surface-2 transition-all"
            >
              Hủy bỏ
            </button>
            <button 
              type="submit" 
              disabled={loading}
              className="px-6 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-amber-500 to-brand-strong text-white hover:opacity-95 shadow-lg shadow-amber-500/20 transition-all flex items-center space-x-2"
            >
              {loading ? 'Đang khởi tạo...' : 'Tạo Thử Thách Ngay'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}