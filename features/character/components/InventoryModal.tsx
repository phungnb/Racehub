'use client'

import React from 'react'

export default function InventoryModal({ isOpen, onClose, inventory, onEquip }: { isOpen: boolean, onClose: () => void, inventory: any[], onEquip: (itemId: string, category: string) => void }) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl animate-fadeIn">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
          <h3 className="text-sm font-black text-white">🎒 Kho đồ trang bị (Inventory)</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xs font-bold px-2 py-1 bg-slate-800 rounded-lg">✕</button>
        </div>

        <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
          {inventory.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-6">Chưa có vật phẩm trong kho.</p>
          ) : (
            inventory.map((inv) => (
              <div key={inv.id} className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">🛡️</span>
                  <div>
                    <h4 className="text-xs font-bold text-white">{inv.avatar_items?.name}</h4>
                    <span className="text-[10px] text-orange-400 uppercase font-semibold">{inv.avatar_items?.category} • {inv.avatar_items?.rarity}</span>
                  </div>
                </div>
                <button 
                  onClick={() => onEquip(inv.item_id, inv.avatar_items?.category)}
                  className="bg-orange-600 hover:bg-orange-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all"
                >
                  Trang bị
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
