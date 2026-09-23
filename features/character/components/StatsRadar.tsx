'use client'

import React from 'react'
import { RunnerStats } from '../types'

export default function StatsRadar({ stats }: { stats: RunnerStats }) {
  const statList = [
    { label: 'ENDURANCE (Sức bền)', value: stats.endurance, color: 'from-brand to-amber-500' },
    { label: 'SPEED (Tốc độ)', value: stats.speed, color: 'from-amber-500 to-yellow-400' },
    { label: 'CONSISTENCY (Đều đặn)', value: stats.consistency, color: 'from-emerald-500 to-teal-400' },
    { label: 'EXPLORER (Khám phá)', value: stats.explorer, color: 'from-cyan-500 to-blue-500' },
    { label: 'TEAM (Đồng đội)', value: stats.team, color: 'from-purple-500 to-pink-500' },
  ]

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 space-y-3 shadow-xl">
      <h3 className="text-xs font-bold uppercase tracking-wider text-fg-muted flex items-center gap-2">
        📊 Chỉ số năng lực Runner
      </h3>

      <div className="space-y-2.5">
        {statList.map((st, idx) => (
          <div key={idx} className="space-y-1">
            <div className="flex justify-between text-[11px] font-bold text-fg">
              <span>{st.label}</span>
              <span className="text-brand">{st.value} PTS</span>
            </div>
            <div className="w-full bg-bg h-2 rounded-full overflow-hidden border border-border/80">
              <div 
                className={`bg-gradient-to-r ${st.color} h-full rounded-full transition-all duration-500`}
                style={{ width: `${Math.min(100, Math.max(5, st.value))}%` }}
              ></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
