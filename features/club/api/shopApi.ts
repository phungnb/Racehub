// Cửa hàng CLB (migration 007900): RaceHub chỉ ghi đơn, tiền chuyển thẳng vào tài khoản ngân hàng của CLB qua VietQR
import { supabase } from '@/shared/lib/supabase'

export type ProductStatus = 'OPEN' | 'CLOSED' | 'HIDDEN'
export type OrderStatus = 'PENDING' | 'PAID' | 'DELIVERED' | 'CANCELLED'
export interface ClubBank { bin: string; account_no: string; account_name: string }
export interface ClubProduct {
  id: string; club_id: string; title: string; description: string | null; image_url: string | null; price_vnd: number
  sizes: string[]; stock: number | null; max_per_order: number; order_deadline: string | null; status: ProductStatus
  sold: number; open: boolean; pending: number | null; paid: number | null; created_at: string
}
export interface OrderItem { size: string | null; qty: number }
export interface ClubOrder {
  id: string; product_id: string; product_title: string; user_id: string | null; buyer: string; items: OrderItem[]; quantity: number
  amount_vnd: number; note: string | null; code: string; status: OrderStatus; status_note: string | null
  paid_at: string | null; delivered_at: string | null; created_at: string
}
export interface ClubShop { is_staff: boolean; bank: ClubBank | null; products: ClubProduct[]; my_orders: ClubOrder[] }
export interface ProductInput {
  id?: string; club_id: string; title: string; description: string | null; image_url: string | null; price_vnd: number
  sizes: string[]; stock: number | null; max_per_order: number; order_deadline: string | null; status: ProductStatus
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}
const n = (o: ClubOrder): ClubOrder => ({ ...o, amount_vnd: Number(o.amount_vnd) })

export const getClubShop = (clubId: string) => rpc<ClubShop>('club_shop', { p_club_id: clubId })
  .then((s) => ({ ...s, my_orders: s.my_orders.map(n) }))
export const saveProduct = (p: ProductInput) => rpc<string>('save_club_product', { p })
export const placeOrder = (productId: string, items: OrderItem[], note: string | null) =>
  rpc<ClubOrder & { bank: ClubBank }>('place_club_order', { p_product_id: productId, p_items: items, p_note: note }).then((o) => ({ ...n(o), bank: o.bank }))
export const cancelMyOrder = (orderId: string) => rpc<ClubOrder>('cancel_my_club_order', { p_order_id: orderId })
export const getProductOrders = (productId: string) =>
  rpc<{ orders: ClubOrder[]; sizes: { size: string; qty: number; paid_qty: number }[]; totals: { orders: number; paid_vnd: number; pending_vnd: number } }>(
    'club_orders_admin', { p_product_id: productId }).then((r) => ({ ...r, orders: r.orders.map(n) }))
export const setOrderStatus = (orderId: string, status: OrderStatus, note?: string | null) =>
  rpc<ClubOrder>('set_club_order_status', { p_order_id: orderId, p_status: status, p_note: note ?? null })

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Chờ chuyển khoản', tone: 'bg-warning/15 text-warning' },
  PAID: { label: 'Đã nhận tiền', tone: 'bg-brand/15 text-brand' },
  DELIVERED: { label: 'Đã giao', tone: 'bg-surface-2 text-fg-muted' },
  CANCELLED: { label: 'Đã huỷ', tone: 'bg-danger/10 text-danger' },
}

/** CSV đơn hàng cho ban quản trị / xưởng may */
export function ordersCsv(orders: ClubOrder[]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const rows = orders.map((o) => [o.code, o.buyer, o.items.map((i) => `${i.size ?? '-'}×${i.qty}`).join(' '), o.quantity, o.amount_vnd,
    ORDER_STATUS[o.status].label, o.note ?? '', new Date(o.created_at).toLocaleString('vi-VN')])
  return '﻿' + [['Mã', 'Người đặt', 'Size', 'SL', 'Tiền (đ)', 'Trạng thái', 'Ghi chú', 'Thời gian'], ...rows].map((r) => r.map(esc).join(',')).join('\n')
}
