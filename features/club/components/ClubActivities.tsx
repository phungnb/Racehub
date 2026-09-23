'use client'

interface ClubActivitiesProps {
  clubId: string;
}

export default function ClubActivities({ clubId }: ClubActivitiesProps) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-4 space-y-3 shadow-xl">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold text-fg">🎯 Sự kiện & Thử thách CLB</h3>
        <button className="text-xs bg-brand/20 text-brand px-2 py-1 rounded-lg font-bold cursor-pointer">
          + Tạo sự kiện
        </button>
      </div>

      <div className="space-y-2">
        <div className="bg-bg p-3.5 rounded-xl border border-border space-y-2">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-semibold">GIẢI ĐẤU TUẦN</span>
              <h4 className="font-bold text-sm mt-1 text-white">Chạy tiếp sức cuối tuần (5km/người)</h4>
            </div>
            <span className="text-xs text-amber-400 font-bold">🪙 500 Xu</span>
          </div>
          <p className="text-xs text-fg-muted">Hoàn thành cự ly 5km trong tuần này để tích lũy quỹ thưởng chung cho đồng đội.</p>
          <button className="w-full bg-surface hover:bg-surface-2 text-brand text-xs font-bold py-2 rounded-lg border border-border cursor-pointer">
            Đăng ký tham gia
          </button>
        </div>
      </div>
    </div>
  )
}