'use client'

import AdminDashboard from '@/components/AdminDashboard'
import ClubAdminPanel from '@/components/ClubAdminPanel'
import { supabase } from '@/lib/supabase'

interface ProfileTabProps {
  profile: any
  t: {
    profileTitle: string
    displayName: string
    stravaStatus: string
  }
}

export default function ProfileTab({ profile, t }: ProfileTabProps) {
  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      <h2 className="text-base font-bold">{t.profileTitle}</h2>
      
      {/* Khối thông tin tên hiển thị & kết nối nguồn dữ liệu */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
        <div className="space-y-2">
          <label className="text-xs text-slate-400 block">{t.displayName}</label>
          <input 
            type="text" 
            readOnly 
            value={profile?.display_name || ''} 
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 outline-none" 
          />
        </div>

        <div className="space-y-3 pt-2">
          <label className="text-xs text-slate-400 block font-bold tracking-wider uppercase">{t.stravaStatus}</label>
          
          <div className="space-y-2">
            {/* Strava */}
            <div className="flex justify-between items-center bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-xs font-bold flex items-center gap-2 text-white">
                🏃 Strava
              </span>
              <button onClick={() => alert('Đang chuyển hướng kết nối Strava...')} className="text-[10px] bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer border border-orange-500/30">
                KẾT NỐI NGAY
              </button>
            </div>

            {/* Garmin Watch */}
            <div className="flex justify-between items-center bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-xs font-bold flex items-center gap-2 text-white">
                ⌚ Garmin Connect
              </span>
              <button onClick={() => alert('Đang kết nối thiết bị Garmin...')} className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer border border-slate-700">
                LIÊN KẾT
              </button>
            </div>

            {/* Apple Health / Watch */}
            <div className="flex justify-between items-center bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-xs font-bold flex items-center gap-2 text-white">
                🍎 Apple Health / Watch
              </span>
              <button onClick={() => alert('Đang đồng bộ Apple Health...')} className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer border border-slate-700">
                LIÊN KẾT
              </button>
            </div>

            {/* Suunto */}
            <div className="flex justify-between items-center bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-xs font-bold flex items-center gap-2 text-white">
                ⏱️ Suunto App
              </span>
              <button onClick={() => alert('Đang kết nối Suunto...')} className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer border border-slate-700">
                LIÊN KẾT
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* KHU VỰC PHÂN QUYỀN & DUYỆT BÀI ADMIN */}
      <ClubAdminPanel profile={profile} />

      {/* NÚT ĐĂNG XUẤT TÀI KHOẢN ĐẶT NGAY TRONG TAB PROFILE */}
      <button
        onClick={handleSignOut}
        className="w-full bg-slate-900 hover:bg-rose-950/40 hover:border-rose-900/60 border border-slate-800 text-slate-300 hover:text-rose-400 font-bold py-3 rounded-2xl text-xs transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-lg"
      >
        <span>🚪 Đăng xuất tài khoản</span>
      </button>
    </div>
  )
}