'use client'

import React from 'react'
import { ProfileData } from '../lib/profileTypes'

export default function RunnerStats({ profile }: { profile: ProfileData }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-wider text-fg-muted">📊 Runner Stats</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-surface border border-border p-3.5 rounded-xl">
          <span className="text-[11px] text-fg-muted block">Tổng KM</span>
          <span className="text-lg font-black text-brand">124.5 <span className="text-xs font-normal">KM</span></span>
        </div>
        <div className="bg-surface border border-border p-3.5 rounded-xl">
          <span className="text-[11px] text-fg-muted block">Challenges</span>
          <span className="text-lg font-black text-amber-400">8 <span className="text-xs font-normal">sự kiện</span></span>
        </div>
        <div className="bg-surface border border-border p-3.5 rounded-xl">
          <span className="text-[11px] text-fg-muted block">Achievements</span>
          <span className="text-base font-bold text-fg">5 huy hiệu</span>
        </div>
        <div className="bg-surface border border-border p-3.5 rounded-xl">
          <span className="text-[11px] text-fg-muted block">XP</span>
          <span className="text-base font-bold text-brand">{profile?.xp || 0} XP</span>
        </div>
      </div>
    </div>
  )
}
