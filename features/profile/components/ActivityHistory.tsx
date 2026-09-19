'use client'

import React from 'react'

export default function ActivityHistory() {
  const activities = [
    { title: "Chạy sáng cùng NBNRAA", distance: "8.2 KM", pace: "5'15\"", date: "Hôm nay" },
    { title: "Long Run cuối tuần", distance: "15.0 KM", pace: "5'30\"", date: "Hôm qua" },
  ]

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-xl">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">📜 Activity History</h3>
      <div className="space-y-2">
        {activities.map((act, idx) => (
          <div key={idx} className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold text-white">{act.title}</h4>
              <span className="text-[10px] text-slate-400">{act.date} • Pace {act.pace}</span>
            </div>
            <span className="text-xs font-extrabold text-orange-400">{act.distance}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
