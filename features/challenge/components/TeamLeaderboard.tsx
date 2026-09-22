'use client';

import { useState } from 'react';
import { Trophy, Users, Award, TrendingUp, ShieldAlert, ArrowUpRight } from 'lucide-react';

interface TeamLeaderboardProps {
  challengeId?: string;
  gameMode?: 'TEAM_SUM' | 'TEAM_AVG' | 'TEAM_GAP' | 'LAST_MEMBER';
}

export default function TeamLeaderboard({ challengeId, gameMode = 'TEAM_SUM' }: TeamLeaderboardProps) {
  const [currentMode, setCurrentMode] = useState<'TEAM_SUM' | 'TEAM_AVG' | 'TEAM_GAP' | 'LAST_MEMBER'>(gameMode);

  // Dữ liệu mẫu bảng xếp hạng đồng đội
  const leaderboardData = [
    {
      rank: 1,
      teamName: 'Đội A - Mãnh Hổ',
      score: 450.5, // Km hoặc Điểm tùy mode
      avgScore: 90.1,
      gap: 3.2,
      lastMemberKm: 45.0,
      activeRate: '100% (5/5)',
      membersCount: 5,
      color: 'from-amber-500/20 border-amber-500/50 text-amber-400'
    },
    {
      rank: 2,
      teamName: 'Đội B - Gió Lốc',
      score: 412.0,
      avgScore: 82.4,
      gap: 5.1,
      lastMemberKm: 38.5,
      activeRate: '80% (4/5)',
      membersCount: 5,
      color: 'from-slate-800 border-[#3a3b3c] text-gray-300'
    },
    {
      rank: 3,
      teamName: 'Đội C - Sấm Sét',
      score: 389.2,
      avgScore: 97.3, // Điểm trung bình cao nhờ ít người mà chất lượng
      gap: 1.5,
      lastMemberKm: 50.2,
      activeRate: '100% (4/4)',
      membersCount: 4,
      color: 'from-slate-800 border-[#3a3b3c] text-gray-300'
    },
  ];

  return (
    <div className="bg-[#18191a] border border-[#2f3031] rounded-2xl p-6 text-white space-y-6 shadow-xl max-w-5xl mx-auto">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-[#2f3031] pb-4 gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center space-x-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            <span>Bảng Xếp Hạng Đồng Đội (Team Leaderboard)</span>
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">Hệ thống Challenge Engine tự động cập nhật và tính điểm minh bạch theo thời gian thực.</p>
        </div>

        {/* Chuyển đổi nhanh các chế độ xem Game Mode */}
        <div className="flex bg-[#242526] p-1 rounded-xl border border-[#3a3b3c] text-xs">
          {[
            { id: 'TEAM_SUM', label: 'Cộng Dồn' },
            { id: 'TEAM_AVG', label: 'Trung Bình' },
            { id: 'TEAM_GAP', label: 'Gap Nội Bộ' },
            { id: 'LAST_MEMBER', label: 'Chốt Đoàn' },
          ].map((mode) => (
            <button
              key={mode.id}
              onClick={() => setCurrentMode(mode.id as any)}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                currentMode === mode.id 
                  ? 'bg-amber-500 text-slate-950 shadow-md' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {/* Thông tin giải thích thể thức đang chọn */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 flex items-center justify-between text-xs text-amber-300">
        <div className="flex items-center space-x-2">
          <TrendingUp className="w-4 h-4 flex-shrink-0 text-amber-400" />
          <span>
            Thể thức hiện tại: <strong className="text-white uppercase">{currentMode}</strong> — 
            {currentMode === 'TEAM_SUM' && ' Xếp hạng dựa trên tổng cự ly dồn lại của tất cả thành viên.'}
            {currentMode === 'TEAM_AVG' && ' Xếp hạng dựa trên điểm trung bình chia đều theo sĩ số active.'}
            {currentMode === 'TEAM_GAP' && ' Đánh giá khoảng cách chiến thuật bám đuổi nội bộ đội.'}
            {currentMode === 'LAST_MEMBER' && ' Xếp hạng dựa trên thành tích của vận động viên chốt đoàn (yếu nhất).'}
          </span>
        </div>
      </div>

      {/* Danh sách Bảng xếp hạng */}
      <div className="space-y-3">
        {leaderboardData.map((team, index) => (
          <div 
            key={index}
            className={`border rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-gradient-to-r ${team.color} transition-all hover:border-amber-500/50`}
          >
            {/* Top Rank & Tên Đội */}
            <div className="flex items-center space-x-4">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm ${
                team.rank === 1 ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/30' :
                team.rank === 2 ? 'bg-slate-300 text-slate-950' : 'bg-amber-700 text-white'
              }`}>
                #{team.rank}
              </div>
              <div>
                <h3 className="font-bold text-sm text-white flex items-center space-x-2">
                  <span>{team.teamName}</span>
                  {team.rank === 1 && <Award className="w-4 h-4 text-amber-400" />}
                </h3>
                <div className="text-[11px] text-gray-400 mt-0.5 flex items-center space-x-3">
                  <span>Sĩ số: <strong>{team.membersCount} VĐV</strong></span>
                  <span>•</span>
                  <span>Tỉ lệ Active: <strong className="text-emerald-400">{team.activeRate}</strong></span>
                </div>
              </div>
            </div>

            {/* Các chỉ số thống kê theo Mode */}
            <div className="flex items-center space-x-6 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-[#3a3b3c]">
              <div className="text-right">
                <div className="text-[10px] uppercase text-gray-400 font-semibold">
                  {currentMode === 'TEAM_SUM' && 'Tổng cự ly'}
                  {currentMode === 'TEAM_AVG' && 'Trung bình / VĐV'}
                  {currentMode === 'TEAM_GAP' && 'Chỉ số Gap'}
                  {currentMode === 'LAST_MEMBER' && 'Chỉ số Chốt Đoàn'}
                </div>
                <div className="text-base font-black text-amber-400">
                  {currentMode === 'TEAM_SUM' && `${team.score} Km`}
                  {currentMode === 'TEAM_AVG' && `${team.avgScore} Km`}
                  {currentMode === 'TEAM_GAP' && `Gap ${team.gap} Km`}
                  {currentMode === 'LAST_MEMBER' && `${team.lastMemberKm} Km`}
                </div>
              </div>
            </div>

          </div>
        ))}
      </div>

    </div>
  );
}
