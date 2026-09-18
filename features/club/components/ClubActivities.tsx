'use client'

interface ClubActivitiesProps {
  clubId: string;
}

export default function ClubActivities({ clubId }: ClubActivitiesProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-xl">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold text-slate-300">🎯 Sự kiện & Thử thách CLB</h3>
        <button className="text-[10px] bg-orange-500/20 text-orange-400 px-2 py-1 rounded-lg font-bold cursor-pointer">
          + Tạo sự kiện
        </button>
      </div>

      <div className="space-y-2">
        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-semibold">GIẢI ĐẤU TUẦN</span>
              <h4 className="font-bold text-sm mt-1 text-white">Chạy tiếp sức cuối tuần (5km/người)</h4>
            </div>
            <span className="text-xs text-amber-400 font-bold">🪙 500 Xu</span>
          </div>
          <p className="text-[10px] text-slate-400">Hoàn thành cự ly 5km trong tuần này để tích lũy quỹ thưởng chung cho đồng đội.</p>
          <button className="w-full bg-slate-900 hover:bg-slate-800 text-orange-400 text-xs font-bold py-2 rounded-lg border border-slate-800 cursor-pointer">
            Đăng ký tham gia
          </button>
        </div>
      </div>
    </div>
  )
}