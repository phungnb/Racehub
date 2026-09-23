'use client'

import React from 'react'
import ProfileAvatar from './ProfileAvatar'
import { ProfileData } from '../lib/profileTypes'

export default function ProfileHeader({ profile, clubName }: { profile: ProfileData, clubName?: string }) {
  const avatarData = { gender: 'male' as const, level: profile?.level || 1 }

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-surface via-surface to-brand/10 border border-brand/30 rounded-2xl p-5 shadow-xl flex items-center space-x-4">
        <div className="w-16 h-16 bg-bg rounded-2xl border border-brand/40 flex items-center justify-center text-3xl shadow-inner">
          🏃‍♂️
        </div>
        <div className="flex-1 space-y-1">
          <h2 className="text-base font-black text-white">{profile?.display_name || 'Runner'}</h2>
          <div className="flex items-center gap-2">
            <span className="text-[10px] bg-brand text-brand-fg font-bold px-2 py-0.5 rounded-full">
              Level {profile?.level || 1}
            </span>
            <span className="text-[10px] bg-surface-2 text-fg font-semibold px-2 py-0.5 rounded-full">
              🛡️ {clubName || 'Chưa tham gia CLB'}
            </span>
          </div>
        </div>
      </div>
      <ProfileAvatar avatar={avatarData} />
    </div>
  )
}
