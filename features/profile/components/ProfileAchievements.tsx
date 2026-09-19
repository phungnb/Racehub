'use client'

import React from 'react'

export default function ProfileAchievements() {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-xl">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">🏆 Achievements & Badges</h3>
      <div className="grid grid-cols-3 gap-2.5 text-center">
        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
          <div className="text-2xl">🔥</div>
          <div className="text-[11px] font-bold text-slate-200">Streak 7 Ngày</div>
          <span className="text-[9px] text-orange-400 block font-semibold">Đã đạt</span>
        </div>
        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
          <div className="text-2xl">⚡</div>
          <div className="text-[11px] font-bold text-slate-200">100 KM Club</div>
          <span className="text-[9px] text-orange-400 block font-semibold">Đã đạt</span>
        </div>
        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 opacity-60 space-y-1">
          <div className="text-2xl">👑</div>
          <div className="text-[11px] font-bold text-slate-400">Marathoner</div>
          <span className="text-[9px] text-slate-500 block font-semibold">Chưa mở</span>
        </div>
      </div>
    </div>
  )
}
