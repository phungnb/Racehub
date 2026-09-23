'use client';

import { useState, useEffect } from 'react';
import CreateChallengeWizard from './CreateChallengeWizard';
import { getChallengesFromSupabase } from '../api/challengeApi';

interface ChallengeTabProps {
  profile?: any;
  challengesSubView?: string;
  challengeSubView?: string;
  setChallengesSubView?: (view: any) => void;
  setChallengeSubView?: (view: any) => void;
}

export default function ChallengeTab({ profile }: ChallengeTabProps) {
  const [showWizardModal, setShowWizardModal] = useState(false);
  const [challenges, setChallenges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const challs = await getChallengesFromSupabase();
      setChallenges(challs);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="space-y-4 text-white p-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold">Trung Tâm Thử Thách</h2>
          <p className="text-xs text-gray-400">Tự tạo kèo đấu hoặc tham gia chinh phục cùng cộng đồng</p>
        </div>
        <button
          onClick={() => setShowWizardModal(true)}
          className="bg-gradient-to-r from-amber-500 to-orange-600 hover:opacity-90 text-slate-950 text-xs font-bold px-4 py-2.5 rounded-xl shadow-lg transition-all flex items-center space-x-1 cursor-pointer"
        >
          <span>⚡ Tạo Thử Thách</span>
        </button>
      </div>

      <div className="bg-[#242526] border border-[#3a3b3c] px-4 py-3 rounded-xl flex items-center justify-between text-xs">
        <div className="flex items-center space-x-2">
          <span className="text-amber-400 font-bold">🪙 Ví Sổ Cái của bạn:</span>
          <span className="text-white font-extrabold">{profile?.xu || 0} Xu</span>
        </div>
        <span className="text-[11px] text-orange-400 bg-orange-500/10 px-2.5 py-1 rounded-lg border border-orange-500/20 font-semibold">
          Hệ thống Sổ cái Kép (Double-entry)
        </span>
      </div>

      <CreateChallengeWizard
        isOpen={showWizardModal}
        profile={profile}
        onClose={() => setShowWizardModal(false)}
        onCreated={() => {
          setShowWizardModal(false);
          fetchData();
        }}
      />

      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-orange-400 uppercase tracking-wider">🎯 Danh Sách Thử Thách ({challenges.length})</h3>
        </div>

        {loading ? (
          <div className="text-center py-8 text-xs text-gray-500">Đang đồng bộ dữ liệu sổ cái...</div>
        ) : challenges.length === 0 ? (
          <div className="bg-[#18191a] border border-[#2f3031] rounded-2xl p-6 text-center text-xs text-gray-400">
            Chưa có thử thách nào được khởi tạo. Hãy bấm &quot;Tạo Thử Thách&quot; để khám phá ngay!
          </div>
        ) : (
          <div className="space-y-3">
            {challenges.map((item) => (
              <div key={item.id} className="bg-[#18191a] border border-[#2f3031] rounded-xl p-4 space-y-2 hover:border-amber-500/50 transition-all">
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold ${
                    item.challenge_type === 'TEAM' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/30' : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                  }`}>
                    {item.challenge_type === 'TEAM' ? `👥 Đội: ${item.game_mode}` : `👤 Cá nhân: ${item.game_mode}`}
                  </span>
                  <span className="text-[10px] text-gray-500">{new Date(item.created_at).toLocaleDateString('vi-VN')}</span>
                </div>
                <h4 className="font-bold text-sm text-white">{item.title}</h4>
                <div className="flex items-center justify-between text-xs text-gray-400 pt-1 border-t border-[#2f3031]">
                  <span>Cự ly tối thiểu: <strong>{item.min_km} Km</strong></span>
                  <span>Quy mô: <strong>{item.max_slots || 50} VĐV</strong></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}