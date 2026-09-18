'use client'

interface FeedTabProps {
  profile: any;
}

export default function FeedTab({ profile }: FeedTabProps) {
  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">Cộng đồng (Feed)</h2>
        <span className="text-xs text-orange-400 font-semibold cursor-pointer">🔔 Thông báo</span>
      </div>

      {/* Story Bar (Live Indicators) */}
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
        <div className="flex flex-col items-center flex-shrink-0 cursor-pointer">
          <div className="w-14 h-14 rounded-full ring-2 ring-emerald-500 p-0.5 animate-pulse bg-slate-900 flex items-center justify-center font-bold text-emerald-400 text-xs">
            LIVE 🔴
          </div>
          <span className="text-[10px] mt-1 text-slate-300">Minh Tuấn</span>
        </div>
        <div className="flex flex-col items-center flex-shrink-0 cursor-pointer">
          <div className="w-14 h-14 rounded-full ring-2 ring-orange-500 p-0.5 bg-slate-900 flex items-center justify-center font-bold text-xs text-orange-400">
            PB!
          </div>
          <span className="text-[10px] mt-1 text-slate-300">Hà Phương</span>
        </div>
      </div>

      {/* Activity Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-orange-500 to-amber-400 flex items-center justify-center font-bold text-slate-950">
              {profile?.display_name?.charAt(0) || 'P'}
            </div>
            <div>
              <h3 className="font-bold text-sm">{profile?.display_name || 'Phụng Nguyễn'}</h3>
              <p className="text-[10px] text-slate-400">30 phút trước tại Công viên Thống Nhất</p>
            </div>
          </div>
          <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded font-semibold">Cấp 5</span>
        </div>

        <div className="bg-slate-950 rounded-xl p-3 border border-slate-800 grid grid-cols-3 gap-2 text-center">
          <div>
            <span className="text-[10px] text-slate-400 block">Quãng đường</span>
            <span className="text-sm font-extrabold text-white">5.20 KM</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block">Pace TB</span>
            <span className="text-sm font-extrabold text-white">6:15</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block">Thời gian</span>
            <span className="text-sm font-extrabold text-white">32:30</span>
          </div>
        </div>

        <div className="flex justify-between items-center pt-2 border-t border-slate-800 text-xs text-slate-400">
          <span>❤️ 12 Thích</span>
          <span>💬 5 Bình luận</span>
          <button className="bg-orange-500/20 text-orange-400 px-3 py-1 rounded-full font-bold cursor-pointer hover:bg-orange-500/30">
            🎁 Tặng Cheer (-5 Xu)
          </button>
        </div>
      </div>
    </div>
  )
}