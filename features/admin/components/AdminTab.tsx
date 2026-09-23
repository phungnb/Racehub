'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/shared/lib/supabase';
import { ShieldAlert, Settings, Coins, Users, Trophy, CheckCircle2, Flame, Share2, Award } from 'lucide-react';

interface AdminTabProps {
  profile?: any;
}

export default function AdminTab({ profile }: AdminTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<'fees' | 'reward' | 'referral'>('fees');
  
  // State cấu hình Biểu phí thử thách
  const [tiers, setTiers] = useState([
    { name: 'Kèo Nhỏ / Solo', min: 1, max: 10, fee: 30 },
    { name: 'Kèo Câu Lạc Bộ', min: 11, max: 50, fee: 50 },
    { name: 'Kèo Đại Hội Lớn', min: 51, max: null, fee: 150 },
  ]);

  // State cấu hình Thưởng Cày Km
  const [kmRate, setKmRate] = useState(1); // 1 km = 1 Xu
  const [maxDailyReward, setMaxDailyReward] = useState(50); // Trần 50 Xu/ngày
  const [minValidPace, setMinValidPace] = useState(3.0);
  const [maxValidPace, setMaxValidPace] = useState(12.0);

  // State cấu hình Giới thiệu (Referral)
  const [refBonusInviter, setRefBonusInviter] = useState(20);
  const [refBonusReferee, setRefBonusReferee] = useState(10);
  const [refMinKmRequired, setRefMinKmRequired] = useState(3.0);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [stats, setStats] = useState({ challengesCount: 0, usersCount: 0 });

  const isAdmin = profile?.email === 'admin@racehub.vn' || profile?.is_admin === true || profile?.role === 'SYSTEM_ADMIN';

  const fetchAdminData = async () => {
    try {
      const [challRes, userRes, settingRes] = await Promise.all([
        supabase.from('challenges').select('id', { count: 'exact', head: true }),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('system_config_versions').select('*').eq('config_key', 'economy_global_config').maybeSingle()
      ]);

      setStats({
        challengesCount: challRes.count || 0,
        usersCount: userRes.count || 0
      });

      if (settingRes.data && settingRes.data.config_value) {
        const val = settingRes.data.config_value;
        if (val.kmRate) setKmRate(val.kmRate);
        if (val.maxDailyReward) setMaxDailyReward(val.maxDailyReward);
        if (val.refBonusInviter) setRefBonusInviter(val.refBonusInviter);
        if (val.refBonusReferee) setRefBonusReferee(val.refBonusReferee);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, []);

  const handleSaveEconomyConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const globalConfig = {
        tiers,
        kmRate,
        maxDailyReward,
        minValidPace,
        maxValidPace,
        refBonusInviter,
        refBonusReferee,
        refMinKmRequired
      };

      const { error } = await supabase.from('system_config_versions').upsert({
        config_key: 'economy_global_config',
        version: Math.floor(Date.now() / 1000),
        status: 'PUBLISHED',
        config_value: globalConfig,
        created_by: profile?.id
      }, { onConflict: 'config_key' });

      if (error) throw error;
      setMessage('Đã cập nhật và lưu toàn bộ chính sách kinh tế Xu thành công!');
    } catch (err: any) {
      alert(`Lỗi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="bg-[#18191a] border border-[#2f3031] rounded-2xl p-8 text-center space-y-3">
        <ShieldAlert className="w-10 h-10 text-rose-500 mx-auto" />
        <h3 className="text-sm font-bold text-white">Truy Cập Bị Từ Chối</h3>
        <p className="text-xs text-gray-400">Khu vực dành riêng cho Quản trị viên hệ thống.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-white p-4">
      <div className="border-b border-[#2f3031] pb-4">
        <h2 className="text-lg font-bold flex items-center space-x-2">
          <Settings className="w-5 h-5 text-amber-500" />
          <span>Quản Trị Kinh Tế Xu & Tăng Trưởng</span>
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">Quản lý biểu phí, chính sách cày km tự động và thưởng giới thiệu.</p>
      </div>

      {/* THANH TAB CHUYỂN ĐỔI */}
      <div className="flex bg-[#18191a] p-1 rounded-2xl border border-[#2f3031] gap-1">
        <button
          onClick={() => setActiveSubTab('fees')}
          className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
            activeSubTab === 'fees' ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-gray-400 hover:text-white'
          }`}
        >
          <Coins className="w-4 h-4" />
          <span>Biểu Phí Giải Đấu</span>
        </button>
        <button
          onClick={() => setActiveSubTab('reward')}
          className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
            activeSubTab === 'reward' ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-gray-400 hover:text-white'
          }`}
        >
          <Flame className="w-4 h-4" />
          <span>Thưởng Cày Km</span>
        </button>
        <button
          onClick={() => setActiveSubTab('referral')}
          className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
            activeSubTab === 'referral' ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-gray-400 hover:text-white'
          }`}
        >
          <Share2 className="w-4 h-4" />
          <span>Thưởng Giới Thiệu</span>
        </button>
      </div>

      {message && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-3 py-2 rounded-xl text-xs flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      <form onSubmit={handleSaveEconomyConfig} className="space-y-4">
        
        {/* TAB 1: BIỂU PHÍ GIẢI ĐẤU */}
        {activeSubTab === 'fees' && (
          <div className="bg-[#18191a] border border-[#2f3031] rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-amber-400 flex items-center space-x-2">
              <Trophy className="w-4 h-4" />
              <span>Cấu Hình Biểu Phí Theo Quy Mô VĐV</span>
            </h3>
            {tiers.map((tier, idx) => (
              <div key={idx} className="bg-[#242526] border border-[#3a3b3c] rounded-xl p-3.5 space-y-2">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span className="text-amber-300">{tier.name}</span>
                  <span className="text-gray-400 text-[11px]">{tier.min} – {tier.max === null ? '∞' : tier.max} VĐV</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Từ</label>
                    <input 
                      type="number" 
                      value={tier.min} 
                      onChange={(e) => {
                        const updated = [...tiers];
                        updated[idx].min = Number(e.target.value);
                        setTiers(updated);
                      }}
                      className="w-full bg-[#18191a] border border-[#3a3b3c] rounded-lg px-2 py-1.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Đến</label>
                    <input 
                      type="number" 
                      value={tier.max === null ? '' : tier.max} 
                      placeholder="∞"
                      onChange={(e) => {
                        const val = e.target.value === '' ? null : Number(e.target.value);
                        const updated = [...tiers];
                        updated[idx].max = val;
                        setTiers(updated);
                      }}
                      className="w-full bg-[#18191a] border border-[#3a3b3c] rounded-lg px-2 py-1.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Phí (Xu)</label>
                    <input 
                      type="number" 
                      value={tier.fee} 
                      onChange={(e) => {
                        const updated = [...tiers];
                        updated[idx].fee = Number(e.target.value);
                        setTiers(updated);
                      }}
                      className="w-full bg-[#18191a] border border-amber-500/50 rounded-lg px-2 py-1.5 text-amber-400 font-bold"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TAB 2: THƯỞNG CÀY KM */}
        {activeSubTab === 'reward' && (
          <div className="bg-[#18191a] border border-[#2f3031] rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-amber-400 flex items-center space-x-2">
              <Flame className="w-4 h-4" />
              <span>Chính Sách Thưởng Tự Động Theo Cự Ly (Auto-Reward)</span>
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-gray-300 mb-1">Tỷ lệ quy đổi (Xu / 1 Km chạy)</label>
                <input 
                  type="number" 
                  step="0.1"
                  value={kmRate}
                  onChange={(e) => setKmRate(Number(e.target.value))}
                  className="w-full bg-[#242526] border border-[#3a3b3c] rounded-xl px-3 py-2 text-amber-400 font-bold"
                />
              </div>
              <div>
                <label className="block font-semibold text-gray-300 mb-1">Trần thưởng tối đa mỗi ngày / User (Xu)</label>
                <input 
                  type="number" 
                  value={maxDailyReward}
                  onChange={(e) => setMaxDailyReward(Number(e.target.value))}
                  className="w-full bg-[#242526] border border-[#3a3b3c] rounded-xl px-3 py-2 text-white font-bold"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-gray-300 mb-1">Pace tối thiểu hợp lệ</label>
                  <input 
                    type="number" 
                    step="0.1"
                    value={minValidPace}
                    onChange={(e) => setMinValidPace(Number(e.target.value))}
                    className="w-full bg-[#242526] border border-[#3a3b3c] rounded-xl px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-300 mb-1">Pace tối đa hợp lệ</label>
                  <input 
                    type="number" 
                    step="0.1"
                    value={maxValidPace}
                    onChange={(e) => setMaxValidPace(Number(e.target.value))}
                    className="w-full bg-[#242526] border border-[#3a3b3c] rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: THƯỞNG GIỚI THIỆU */}
        {activeSubTab === 'referral' && (
          <div className="bg-[#18191a] border border-[#2f3031] rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-amber-400 flex items-center space-x-2">
              <Share2 className="w-4 h-4" />
              <span>Chính Sách Giới Thiệu Tăng Trưởng (Referral Funnel)</span>
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-gray-300 mb-1">Thưởng cho Người mời (Xu)</label>
                <input 
                  type="number" 
                  value={refBonusInviter}
                  onChange={(e) => setRefBonusInviter(Number(e.target.value))}
                  className="w-full bg-[#242526] border border-[#3a3b3c] rounded-xl px-3 py-2 text-amber-400 font-bold"
                />
              </div>
              <div>
                <label className="block font-semibold text-gray-300 mb-1">Thưởng chào mừng cho Người được mời (Xu)</label>
                <input 
                  type="number" 
                  value={refBonusReferee}
                  onChange={(e) => setRefBonusReferee(Number(e.target.value))}
                  className="w-full bg-[#242526] border border-[#3a3b3c] rounded-xl px-3 py-2 text-amber-400 font-bold"
                />
              </div>
              <div>
                <label className="block font-semibold text-gray-300 mb-1">Điều kiện kích hoạt: Người mới phải chạy tối thiểu (Km)</label>
                <input 
                  type="number" 
                  step="0.5"
                  value={refMinKmRequired}
                  onChange={(e) => setRefMinKmRequired(Number(e.target.value))}
                  className="w-full bg-[#242526] border border-[#3a3b3c] rounded-xl px-3 py-2 text-white"
                />
              </div>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-gradient-to-r from-amber-500 to-orange-600 hover:opacity-95 text-slate-950 font-black py-2.5 rounded-xl text-xs shadow-lg transition-all cursor-pointer"
        >
          {loading ? 'Đang lưu cấu hình...' : 'Lưu & Xuất Bản Toàn Bộ Chính Sách'}
        </button>

      </form>
    </div>
  );
}
