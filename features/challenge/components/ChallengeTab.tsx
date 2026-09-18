'use client'

import { useState } from 'react'
import CreateChallengeWizard from './CreateChallengeWizard'

interface ChallengeTabProps {
  profile: any;
  challengeSubView: 'discover' | 'create';
  setChallengeSubView: (view: 'discover' | 'create') => void;
}

export default function ChallengeTab({ profile, challengeSubView, setChallengeSubView }: ChallengeTabProps) {
  // Quản lý state hiển thị Wizard tạo thử thách chuẩn kiến trúc mới
  const [showWizardModal, setShowWizardModal] = useState(false)

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* HEADER & NÚT TẠO THỬ THÁCH CHÍNH */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold">Thử thách & Kèo đấu</h2>
          <p className="text-[10px] text-slate-400">Sân chơi đối kháng và chinh phục mục tiêu chuẩn RaceHub</p>
        </div>
        <button 
          onClick={() => setShowWizardModal(true)}
          className="bg-orange-500 hover:bg-orange-600 text-slate-950 text-xs font-black px-4 py-2.5 rounded-xl shadow-lg shadow-orange-500/20 cursor-pointer transition-all flex items-center gap-1.5"
        >
          <span>⚡ Tạo Thử Thách</span>
        </button>
      </div>

      {/* WIZARD TẠO THỬ THÁCH 5 LỚP */}
      {showWizardModal && (
        <CreateChallengeWizard 
          profile={profile}
          onClose={() => setShowWizardModal(false)}
          onCreated={() => {
            // Logic load lại danh sách thử thách sau khi tạo thành công
            setShowWizardModal(false)
          }}
        />
      )}

      {/* PHẦN TRÊN: THỬ THÁCH CỦA TÔI (MY CHALLENGES) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-orange-400 uppercase tracking-wider">📌 Thử thách của tôi</h3>
          <span className="text-[10px] text-slate-500">Đang tham gia (1)</span>
        </div>

        <div className="bg-slate-900 border border-orange-500/30 rounded-2xl p-4 space-y-3 shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-orange-500 text-slate-950 text-[9px] font-black px-3 py-0.5 rounded-bl-xl uppercase">
            Cá nhân
          </div>
          <div className="flex justify-between items-start">
            <div>
              <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded font-semibold">KÈO SOLO 1-1 (COMPETITIVE)</span>
              <h4 className="text-sm font-bold mt-1 text-white">Kèo Solo 5km Tốc Độ vs. Minh Quân</h4>
            </div>
            <span className="text-xs text-amber-400 font-bold">Cọc: 50 Xu</span>
          </div>
          <p className="text-[11px] text-slate-400">Trạng thái: Đang chờ đối thủ nhận kèo qua hệ thống Ledger...</p>
          <div className="flex gap-2 pt-1">
            <button className="w-full bg-slate-800 hover:bg-slate-700 text-xs font-bold py-2 rounded-xl text-slate-300 cursor-pointer transition-all">
              Hủy kèo & Hoàn cọc (Ledger Refund)
            </button>
          </div>
        </div>
      </div>

      {/* PHẦN DƯỚI: KHÁM PHÁ & CỘNG ĐỒNG (DISCOVER & COMMUNITY) */}
      <div className="space-y-3 pt-2">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">🌐 Khám phá & Cộng đồng</h3>

        {/* Thử thách từ CLB đang sinh hoạt */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-semibold">CLB ĐÀ NẴNG TRAIL</span>
              <h4 className="text-sm font-bold mt-1 text-white">Giải nội bộ: Chinh phục đỉnh Sơn Trà</h4>
            </div>
            <span className="text-xs text-amber-400 font-bold">🪙 Quỹ Treasury</span>
          </div>
          <p className="text-[11px] text-slate-400">Thử thách độc quyền dành riêng cho thành viên chính thức của câu lạc bộ.</p>
          <button className="w-full bg-slate-950 hover:bg-slate-800 border border-slate-800 text-orange-400 font-bold py-2 rounded-xl text-xs cursor-pointer transition-all">
            Xem chi tiết căn cứ CLB
          </button>
        </div>

        {/* Thử thách nổi bật công khai */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-semibold">VOLUME MỞ RỘNG</span>
              <h4 className="text-sm font-bold mt-1 text-white">Thử thách 100km Tháng 10</h4>
            </div>
            <span className="text-xs text-slate-400">12.4k tham gia</span>
          </div>
          <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden">
            <div className="bg-orange-500 h-full w-2/3"></div>
          </div>
          <button className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 rounded-xl text-xs cursor-pointer transition-all">
            Tham gia ngay
          </button>
        </div>
      </div>
    </div>
  )
}