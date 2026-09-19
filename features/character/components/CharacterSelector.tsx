'use client'

import React from 'react'
import { PRESET_RUNNERS } from '../lib/characterConfig'

export default function CharacterSelector({ selectedGender, onSelectGender }: { selectedGender: 'male' | 'female', onSelectGender: (gender: 'male' | 'female') => void }) {
  const currentRunner = PRESET_RUNNERS[selectedGender];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-xl">
      <div className="flex justify-between items-center">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">👤 Mẫu Nhân Vật Runner</h3>
        
        {/* Nút chuyển đổi Nam / Nữ tích hợp gọn gàng trong 1 ô */}
        <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center space-x-1">
          <button
            onClick={() => onSelectGender('male')}
            className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${selectedGender === 'male' ? 'bg-orange-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
          >
            👦 Nam
          </button>
          <button
            onClick={() => onSelectGender('female')}
            className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${selectedGender === 'female' ? 'bg-orange-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
          >
            👧 Nữ
          </button>
        </div>
      </div>

      {/* Khung hiển thị trực quan thông tin mẫu đang chọn */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center space-x-3.5">
        <div className="w-16 h-20 relative rounded-lg overflow-hidden bg-slate-900 border border-slate-800 flex-shrink-0 flex items-center justify-center">
          <img 
            src={currentRunner.previewImage} 
            alt={currentRunner.name} 
            className="w-full h-full object-cover"
          />
        </div>
        <div className="space-y-1 flex-1">
          <span className="text-xs font-black text-white block">{currentRunner.name}</span>
          <p className="text-[10px] text-slate-400 leading-relaxed">
            Hệ thống 3D Studio đồng bộ trang phục và chỉ số chuẩn game hóa RaceHub.
          </p>
          <span className="inline-block text-[9px] bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded font-bold">
            Đang kích hoạt
          </span>
        </div>
      </div>
    </div>
  )
}