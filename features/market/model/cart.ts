'use client'

import { useCallback, useEffect, useState } from 'react'

// Giỏ hàng lưu trên máy (mỗi cửa hàng một giỏ). Giá / tồn kho luôn do server tính lại lúc đặt.
export interface CartEntry { product_id: string; variant_id: string | null; qty: number }
const key = (partnerId: string) => `racehub.cart.${partnerId}`
const EVENT = 'racehub-cart'

function read(partnerId: string): CartEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(partnerId)) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is CartEntry => typeof x?.product_id === 'string' && Number.isInteger(x.qty) && x.qty > 0).slice(0, 40) : []
  } catch { return [] }
}
function write(partnerId: string, items: CartEntry[]) {
  try { localStorage.setItem(key(partnerId), JSON.stringify(items)) } catch { /* bộ nhớ bị chặn: giỏ chỉ sống trong phiên */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: partnerId }))
}
export const sameLine = (a: CartEntry, b: { product_id: string; variant_id: string | null }) => a.product_id === b.product_id && a.variant_id === b.variant_id

export function addToCart(partnerId: string, line: CartEntry) {
  const items = read(partnerId)
  const hit = items.find((x) => sameLine(x, line))
  if (hit) hit.qty = Math.min(20, hit.qty + line.qty)
  else items.push({ ...line, qty: Math.min(20, line.qty) })
  write(partnerId, items)
}

export function useCart(partnerId: string) {
  const [items, setItems] = useState<CartEntry[]>([])
  useEffect(() => {
    const sync = () => setItems(read(partnerId))
    sync()
    const on = (e: Event) => { if ((e as CustomEvent).detail === partnerId) sync() }
    window.addEventListener(EVENT, on)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', sync) }
  }, [partnerId])
  const setQty = useCallback((line: CartEntry, qty: number) =>
    write(partnerId, read(partnerId).map((x) => (sameLine(x, line) ? { ...x, qty: Math.max(1, Math.min(20, qty)) } : x))), [partnerId])
  const remove = useCallback((line: CartEntry) => write(partnerId, read(partnerId).filter((x) => !sameLine(x, line))), [partnerId])
  const clear = useCallback(() => write(partnerId, []), [partnerId])
  return { items, count: items.reduce((s, x) => s + x.qty, 0), setQty, remove, clear }
}
