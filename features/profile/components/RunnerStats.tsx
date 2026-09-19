'use client'

import React from 'react'
import { ProfileData } from '../lib/profileTypes'

export default function RunnerStats({ profile }: { profile: ProfileData }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">📊 Runner Stats</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[11px] text-slate-400 block">Tổng KM</span>
          <span className="text-lg font-black text-orange-400">124.5 <span className="text-xs font-normal">KM</span></span>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[11px] text-slate-400 block">Challenges</span>
          <span className="text-lg font-black text-amber-400">8 <span className="text-xs font-normal">sự kiện</span></span>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[11px] text-slate-400 block">Achievements</span>
          <span className="text-base font-bold text-slate-200">5 huy hiệu</span>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[11px] text-slate-400 block">XP</span>
          <span className="text-base font-bold text-orange-400">{profile?.xp || 0} XP</span>
        </div>
      </div>
    </div>
  )
}
