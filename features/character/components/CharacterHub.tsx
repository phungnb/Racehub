'use client'

import React, { useEffect, useState } from 'react'
import { fetchUserAvatar, fetchUserEquipment, fetchUserInventory, equipItemRpc } from '../api/characterApi'
import InventoryModal from './InventoryModal'
import { PRESET_RUNNERS } from '../model/characterConfig'
import { supabase } from '@/shared/lib/supabase'
import { levelProgress, MAX_XP } from '@/features/progression'
import { formatNumber } from '@/shared/lib/format'

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

  const handleEquip = async (itemId: string, category: string) => {
    try {
      await equipItemRpc(itemId, category)
      await loadData()
      setIsInventoryOpen(false)
    } catch (err: any) {
      alert("Lỗi trang bị: " + err.message)
    }
  }

  if (loading) {
    return <div className="text-center py-10 text-xs text-fg-muted">Đang tải thông tin nhân vật...</div>
  }

  const currentLevel = avatar?.level || 1
  const currentXp = avatar?.xp || 0
  // Ngưỡng XP theo bảng cấp độ trong tài liệu (Lv2: 1.000, Lv3: 5.000, ...)
  const progress = levelProgress(currentXp, currentLevel)
  const xpProgress = progress.span > 0 ? (progress.value / progress.span) * 100 : 100
  const currentRunner = PRESET_RUNNERS[selectedGender] || PRESET_RUNNERS.male

  return (
    <div className="space-y-5 animate-fadeIn pb-10">
      
      {/* KHUNG HIỂN THỊ NHÂN VẬT LỚN & CHỌN NHÂN VẬT TRỰC QUAN */}
      <div className="bg-gradient-to-b from-surface via-surface to-brand/10 border border-brand/30 rounded-3xl p-5 shadow-2xl space-y-4">
        
        {/* Header thông tin & nút chuyển đổi Nam/Nữ to rõ */}
        <div className="flex justify-between items-center relative z-20">
          <span className="text-xs font-black uppercase tracking-widest text-brand bg-brand/10 px-3 py-1 rounded-full border border-brand/20">
            {currentRunner.name}
          </span>

          {/* Toggle chọn Nam / Nữ trực tiếp trên khung lớn (Đảm bảo z-index cao và bắt sự kiện chuẩn) */}
          <div className="bg-bg p-1 rounded-xl border border-border flex items-center space-x-1 shadow-md">
            <button
              type="button"
              onClick={() => handleSelectGender('male')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer select-none ${selectedGender === 'male' ? 'bg-brand text-brand-fg shadow-lg' : 'text-fg-muted hover:text-white'}`}
            >
              👦 Nam
            </button>
            <button
              type="button"
              onClick={() => handleSelectGender('female')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer select-none ${selectedGender === 'female' ? 'bg-brand text-brand-fg shadow-lg' : 'text-fg-muted hover:text-white'}`}
            >
              👧 Nữ
            </button>
          </div>
        </div>

        {/* Khung chứa ảnh nhân vật size lớn chân thực */}
        <div className="relative w-full h-96 bg-bg/80 rounded-2xl border border-border/80 overflow-hidden flex items-center justify-center shadow-inner group">
          <div className="absolute inset-0 bg-gradient-to-t from-brand/10 via-transparent to-transparent pointer-events-none"></div>
          
          <img 
            src={currentRunner.previewImage} 
            alt={currentRunner.name} 
            className="h-full w-full object-contain filter drop-shadow-[0_15px_15px_rgba(0,0,0,0.8)] transform group-hover:scale-102 transition-transform duration-500 select-none"
          />

          {/* Badge cấp độ nổi bật */}
          <div className="absolute top-3 right-3 bg-brand text-brand-fg text-xs font-black px-3 py-1 rounded-full border border-brand shadow-lg">
            LV.{currentLevel}
          </div>

        </div>

        {/* Thông tin cấp độ & Thanh XP */}
        <div className="space-y-2 text-center pt-1">
          <h2 className="text-base font-black text-white">Cấp độ {currentLevel} • {selectedGender === 'female' ? 'Nữ Runner' : 'Nam Runner'}</h2>
          
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-fg-muted font-semibold px-1">
              <span>Kinh nghiệm (XP)</span>
              <span className="text-brand">{formatNumber(currentXp)} / {formatNumber(progress.next?.minXp ?? MAX_XP)} XP</span>
            </div>
            <div className="w-full bg-bg h-2.5 rounded-full overflow-hidden border border-border">
              <div 
                className="bg-gradient-to-r from-brand to-brand-strong h-full rounded-full transition-all duration-700 shadow-inner"
                style={{ width: `${xpProgress}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Nút mở tủ đồ trang bị */}
        <button 
          type="button"
          onClick={() => setIsInventoryOpen(true)}
          className="w-full bg-brand hover:bg-brand-strong text-brand-fg font-bold py-3 rounded-xl text-xs transition-all shadow-lg cursor-pointer flex items-center justify-center gap-2"
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