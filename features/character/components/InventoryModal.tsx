'use client'

import React from 'react'

export default function InventoryModal({ isOpen, onClose, inventory, onEquip }: { isOpen: boolean, onClose: () => void, inventory: any[], onEquip: (itemId: string, category: string) => void }) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl animate-fadeIn">
        <div className="flex justify-between items-center border-b border-border pb-3">
          <h3 className="text-sm font-black text-white">🎒 Kho đồ trang bị (Inventory)</h3>
          <button onClick={onClose} className="text-fg-muted hover:text-white text-xs font-bold px-2 py-1 bg-surface-2 rounded-lg">✕</button>
        </div>

        <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
          {inventory.length === 0 ? (
            <p className="text-xs text-fg-subtle text-center py-6">Chưa có vật phẩm trong kho.</p>
          ) : (
            inventory.map((inv) => (
              <div key={inv.id} className="bg-bg p-3 rounded-xl border border-border flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">🛡️</span>
                  <div>
                    <h4 className="text-xs font-bold text-white">{inv.avatar_items?.name}</h4>
                    <span className="text-xs text-brand uppercase font-semibold">{inv.avatar_items?.category} • {inv.avatar_items?.rarity}</span>
                  </div>
                </div>
                <button 
                  onClick={() => onEquip(inv.item_id, inv.avatar_items?.category)}
                  className="bg-brand hover:bg-brand-strong text-brand-fg text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
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
