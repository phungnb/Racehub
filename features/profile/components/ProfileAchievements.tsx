'use client'

import React from 'react'

export default function ProfileAchievements() {
  return (
    <div className="bg-surface border border-border rounded-2xl p-4 space-y-3 shadow-xl">
      <h3 className="text-xs font-bold uppercase tracking-wider text-fg-muted">🏆 Achievements & Badges</h3>
      <div className="grid grid-cols-3 gap-2.5 text-center">
        <div className="bg-bg p-3 rounded-xl border border-border space-y-1">
          <div className="text-2xl">🔥</div>
          <div className="text-[11px] font-bold text-fg">Streak 7 Ngày</div>
          <span className="text-[9px] text-brand block font-semibold">Đã đạt</span>
        </div>
        <div className="bg-bg p-3 rounded-xl border border-border space-y-1">
          <div className="text-2xl">⚡</div>
          <div className="text-[11px] font-bold text-fg">100 KM Club</div>
          <span className="text-[9px] text-brand block font-semibold">Đã đạt</span>
        </div>
        <div className="bg-bg p-3 rounded-xl border border-border opacity-60 space-y-1">
          <div className="text-2xl">👑</div>
          <div className="text-[11px] font-bold text-fg-muted">Marathoner</div>
          <span className="text-[9px] text-fg-subtle block font-semibold">Chưa mở</span>
        </div>
      </div>
    </div>
  )
}
