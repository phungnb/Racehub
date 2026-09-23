'use client'

import React, { useEffect, useState } from 'react'
import { fetchUserAvatar, fetchUserEquipment, fetchUserInventory, equipItemRpc } from '../api/characterApi'
import InventoryModal from './InventoryModal'
import { PRESET_RUNNERS } from '../lib/characterConfig'
import { supabase } from '@/shared/lib/supabase'

export default function CharacterHub({ userId }: { userId: string }) {
  const [avatar, setAvatar] = useState<any>(null)
  const [equipment, setEquipment] = useState<any>(null)
  const [inventory, setInventory] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [isInventoryOpen, setIsInventoryOpen] = useState(false)
  const [selectedGender, setSelectedGender] = useState<'male' | 'female'>('male')

  const loadData = async () => {
    try {
      const [avatarData, equipData, invData] = await Promise.all([
        fetchUserAvatar(userId),
        fetchUserEquipment(userId),
        fetchUserInventory(userId)
      ])
      setAvatar(avatarData)
      setEquipment(equipData)
      setInventory(invData)
      if (avatarData?.gender) {
        setSelectedGender(avatarData.gender)
      }
    } catch (err) {
      console.error("Lỗi tải dữ liệu nhân vật:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (userId) loadData()
  }, [userId])

  // Xử lý chuyển đổi giới tính cực kỳ an toàn (Dùng upsert để tự tạo bản ghi nếu chưa tồn tại)
  const handleSelectGender = async (gender: 'male' | 'female') => {
    // Cập nhật state ngay lập tức để UI phản hồi siêu tốc không bị delay
    setSelectedGender(gender)
    setAvatar((prev: any) => ({ ...(prev || {}), gender }))

    try {
      // Kiểm tra xem user đã có dòng trong user_avatar chưa, nếu chưa thì insert, có rồi thì update
      const { error } = await supabase
        .from('user_avatar')
        .upsert({ 
          user_id: userId, 
          gender: gender,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' })

      if (error) {
        console.error("Supabase upsert error:", error.message)
      }
    } catch (err: any) {
      console.error("Lỗi kết nối khi cập nhật giới tính:", err.message)
    }
  }

  const handleEquip = async (itemId: string) => {
    try {
      await equipItemRpc(itemId)
      await loadData()
      setIsInventoryOpen(false)
    } catch (err: any) {
      alert("Lỗi trang bị: " + err.message)
    }
  }

  if (loading) {
    return <div className="text-center py-10 text-xs text-slate-400">Đang tải thông tin nhân vật...</div>
  }

  const currentLevel = avatar?.level || 1
  const currentXp = avatar?.xp || 0
  const maxXp = currentLevel * 1000
  const xpProgress = Math.min(100, (currentXp / maxXp) * 100)
  const currentRunner = PRESET_RUNNERS[selectedGender] || PRESET_RUNNERS.male

  return (
    <div className="space-y-5 animate-fadeIn pb-10">
      
      {/* KHUNG HIỂN THỊ NHÂN VẬT LỚN & CHỌN NHÂN VẬT TRỰC QUAN */}
      <div className="bg-gradient-to-b from-slate-900 via-slate-900 to-orange-950/40 border border-orange-500/30 rounded-3xl p-5 shadow-2xl space-y-4">
        
        {/* Header thông tin & nút chuyển đổi Nam/Nữ to rõ */}
        <div className="flex justify-between items-center relative z-20">
          <span className="text-[10px] font-black uppercase tracking-widest text-orange-400 bg-orange-500/10 px-3 py-1 rounded-full border border-orange-500/20">
            {currentRunner.name}
          </span>

          {/* Toggle chọn Nam / Nữ trực tiếp trên khung lớn (Đảm bảo z-index cao và bắt sự kiện chuẩn) */}
          <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center space-x-1 shadow-md">
            <button
              type="button"
              onClick={() => handleSelectGender('male')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer select-none ${selectedGender === 'male' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
            >
              👦 Nam
            </button>
            <button
              type="button"
              onClick={() => handleSelectGender('female')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer select-none ${selectedGender === 'female' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
            >
              👧 Nữ
            </button>
          </div>
        </div>

        {/* Khung chứa ảnh nhân vật size lớn chân thực */}
        <div className="relative w-full h-96 bg-slate-950/80 rounded-2xl border border-slate-800/80 overflow-hidden flex items-center justify-center shadow-inner group">
          <div className="absolute inset-0 bg-gradient-to-t from-orange-600/10 via-transparent to-transparent pointer-events-none"></div>
          
          <img 
            src={currentRunner.previewImage} 
            alt={currentRunner.name} 
            className="h-full w-full object-contain filter drop-shadow-[0_15px_15px_rgba(0,0,0,0.8)] transform group-hover:scale-102 transition-transform duration-500 select-none"
          />

          {/* Badge cấp độ nổi bật */}
          <div className="absolute top-3 right-3 bg-orange-600 text-white text-xs font-black px-3 py-1 rounded-full border border-orange-400 shadow-lg">
            LV.{currentLevel}
          </div>

        </div>

        {/* Thông tin cấp độ & Thanh XP */}
        <div className="space-y-2 text-center pt-1">
          <h2 className="text-base font-black text-white">Cấp độ {currentLevel} • {selectedGender === 'female' ? 'Nữ Runner' : 'Nam Runner'}</h2>
          
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-slate-400 font-semibold px-1">
              <span>Kinh nghiệm (XP)</span>
              <span className="text-orange-400">{currentXp} / {maxXp} XP</span>
            </div>
            <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden border border-slate-800">
              <div 
                className="bg-gradient-to-r from-orange-500 to-amber-400 h-full rounded-full transition-all duration-700 shadow-inner"
                style={{ width: `${xpProgress}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Nút mở tủ đồ trang bị */}
        <button 
          type="button"
          onClick={() => setIsInventoryOpen(true)}
          className="w-full bg-orange-600 hover:bg-orange-500 text-white font-bold py-3 rounded-xl text-xs transition-all shadow-lg cursor-pointer flex items-center justify-center gap-2"
        >
          <span>🎒</span> Mở Tủ Đồ Trang Bị (14 Slots)
        </button>

      </div>

      {/* MODAL KHO ĐỒ */}
      <InventoryModal 
        isOpen={isInventoryOpen} 
        onClose={() => setIsInventoryOpen(false)} 
        inventory={inventory} 
        onEquip={handleEquip} 
      />

    </div>
  )
}