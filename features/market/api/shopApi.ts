// Cửa hàng đối tác (migration 016300): sản phẩm, biến thể, tồn kho, đơn hàng. RaceHub KHÔNG giữ tiền — khách chuyển khoản thẳng cho đối tác hoặc COD.
import { supabase } from '@/shared/lib/supabase'
import { marketErrorMessage } from './marketApi'

export type ProductStatus = 'ACTIVE' | 'HIDDEN'
export type OrderStatus = 'PENDING' | 'PAID' | 'SHIPPING' | 'DONE' | 'CANCELLED'
export type PayMethod = 'BANK' | 'COD'
export interface ShopBank { bin: string; account_no: string; account_name: string }
export interface Variant { id: string; name: string; price_vnd: number; own_price: number | null; stock: number | null; sku: string | null }
export interface Product {
  id: string; partner_id: string; title: string; description: string | null; images: string[]; category: string | null
  price_vnd: number; compare_price_vnd: number | null; sku: string | null; stock: number | null; status: ProductStatus; sold: number
  variants: Variant[]; price_min: number; price_max: number; in_stock: boolean; created_at: string
}
export interface ShopSettings {
  ship_fee_vnd: number; free_ship_over_vnd: number | null; cod_enabled: boolean; shop_policy: string | null; bank_ready: boolean; bank?: ShopBank | null
}
export interface ShopPartner { id: string; name: string; avatar_url: string | null; area: string | null; kind: string; status: string; verified: boolean; is_mine: boolean }
export interface Shop { partner: ShopPartner; settings: ShopSettings; products: Product[] }
export interface ProductDetail { product: Product; partner: ShopPartner; settings: ShopSettings }
export interface OrderItem { product_id: string; variant_id: string | null; title: string; variant: string | null; price_vnd: number; qty: number; image: string | null }
export interface ShopOrder {
  id: string; partner_id: string; shop_name: string; user_id: string | null; code: string; items: OrderItem[]; quantity: number
  subtotal_vnd: number; ship_fee_vnd: number; amount_vnd: number; buyer_name: string; buyer_phone: string; ship_address: string; note: string | null
  payment_method: PayMethod; status: OrderStatus; status_note: string | null; tracking_code: string | null
  paid_at: string | null; shipped_at: string | null; done_at: string | null; created_at: string; bank: ShopBank | null
}
export interface OrdersAdmin {
  orders: ShopOrder[]
  totals: { pending: number; paid: number; shipping: number; done: number; revenue_vnd: number; awaiting_vnd: number }
}
export interface ProductInput {
  id?: string; partner_id: string; title: string; description: string | null; images: string[]; category: string | null
  price_vnd: number; compare_price_vnd: number | null; sku: string | null; stock: number | null; status: ProductStatus
  variants: { id?: string; name: string; price_vnd: number | null; stock: number | null; sku?: string | null }[]
}
export interface Buyer { name: string; phone: string; address: string }
export interface CartLine { product_id: string; variant_id: string | null; qty: number }

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}
const num = (o: ShopOrder): ShopOrder => ({ ...o, amount_vnd: Number(o.amount_vnd), subtotal_vnd: Number(o.subtotal_vnd) })

export const getShop = (partnerId: string) => rpc<Shop>('partner_shop', { p_partner_id: partnerId })
export const getShopProduct = (id: string) => rpc<ProductDetail>('get_shop_product', { p_id: id })
export const saveShopSettings = (partnerId: string, s: Omit<ShopSettings, 'bank_ready'> & { bank: ShopBank | null }) =>
  rpc<ShopSettings>('save_partner_shop', { p_partner_id: partnerId, s })
export const saveProduct = (p: ProductInput) => rpc<Product>('save_partner_product', { p })
export const deleteProduct = (id: string) => rpc<null>('delete_partner_product', { p_id: id })
export const placeOrder = (partnerId: string, items: CartLine[], buyer: Buyer, method: PayMethod, note: string | null) =>
  rpc<ShopOrder>('place_partner_order', { p_partner_id: partnerId, p_items: items, p_buyer: buyer, p_method: method, p_note: note }).then(num)
export const myOrders = () => rpc<ShopOrder[]>('my_partner_orders', {}).then((x) => (x ?? []).map(num))
export const cancelMyOrder = (id: string) => rpc<ShopOrder>('cancel_my_partner_order', { p_order_id: id }).then(num)
export const shopOrders = (partnerId: string) =>
  rpc<OrdersAdmin>('partner_orders_admin', { p_partner_id: partnerId, p_status: null }).then((r) => ({ ...r, orders: r.orders.map(num) }))
export const setOrderStatus = (id: string, status: OrderStatus, note?: string | null, tracking?: string | null) =>
  rpc<ShopOrder>('set_partner_order_status', { p_order_id: id, p_status: status, p_note: note ?? null, p_tracking: tracking ?? null }).then(num)

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Chờ xác nhận', tone: 'bg-warning/15 text-warning' },
  PAID: { label: 'Đã nhận tiền', tone: 'bg-brand/15 text-brand' },
  SHIPPING: { label: 'Đang giao', tone: 'bg-brand/15 text-brand' },
  DONE: { label: 'Hoàn tất', tone: 'bg-surface-2 text-fg-muted' },
  CANCELLED: { label: 'Đã huỷ', tone: 'bg-danger/10 text-danger' },
}
export const PAY_LABEL: Record<PayMethod, string> = { BANK: 'Chuyển khoản', COD: 'Thanh toán khi nhận hàng (COD)' }

export const shopErrorMessage = (e: unknown): string => {
  const raw = (e as { message?: string } | null)?.message ?? ''
  const out = /OUT_OF_STOCK(?::\s*(.+))?/.exec(raw)
  if (out) return out[1] ? `“${out[1]}” không đủ hàng. Hãy giảm số lượng.` : 'Sản phẩm không đủ hàng. Hãy giảm số lượng.'
  const MAP: Record<string, string> = {
    SHOP_NOT_FOUND: 'Cửa hàng chưa mở hoặc chưa được xác minh.',
    PRODUCT_NOT_FOUND: 'Sản phẩm không tồn tại hoặc đã ngừng bán.',
    PRODUCT_UNAVAILABLE: 'Có sản phẩm đã ngừng bán — hãy xoá khỏi giỏ.',
    VARIANT_REQUIRED: 'Hãy chọn phân loại (size / màu…).',
    OWN_SHOP: 'Bạn không thể mua hàng của chính cửa hàng mình.',
    EMPTY_CART: 'Giỏ hàng trống.',
    INVALID_QUANTITY: 'Số lượng mỗi sản phẩm từ 1 đến 20.',
    INVALID_BUYER: 'Nhập họ tên, số điện thoại (10 số) và địa chỉ nhận hàng (≥ 8 ký tự).',
    INVALID_PAYMENT: 'Chọn cách thanh toán.',
    BANK_MISSING: 'Cửa hàng chưa nhận chuyển khoản — chọn COD hoặc liên hệ cửa hàng.',
    COD_DISABLED: 'Cửa hàng không nhận COD — hãy chuyển khoản.',
    INVALID_PRODUCT: 'Tên sản phẩm 2–100 ký tự.',
    INVALID_PRICE: 'Giá từ 0 đến 50.000.000đ; giá gốc phải cao hơn giá bán.',
    INVALID_VARIANT: 'Giá / tồn kho của phân loại chưa hợp lệ.',
    TOO_MANY_VARIANTS: 'Tối đa 30 phân loại.',
    TOO_MANY_IMAGES: 'Tối đa 8 ảnh.',
    TOO_MANY_PRODUCTS: 'Tối đa 200 sản phẩm.',
    INVALID_SHIPPING: 'Phí giao hàng chưa hợp lệ.',
    INVALID_BANK: 'Tài khoản ngân hàng chưa đúng: chọn ngân hàng, số tài khoản 4–20 ký tự, tên chủ tài khoản.',
    ORDER_NOT_FOUND: 'Không tìm thấy đơn hàng.',
    ORDER_LOCKED: 'Đơn đã được xử lý, không thể huỷ — hãy liên hệ cửa hàng.',
    INVALID_STATUS: 'Không thể chuyển đơn sang trạng thái này.',
    PAYMENT_NOT_CONFIRMED: 'Đơn chuyển khoản phải xác nhận đã nhận tiền trước khi giao.',
    FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  }
  const k = Object.keys(MAP).find((x) => raw.includes(x))
  return k ? MAP[k] : marketErrorMessage(e)
}

/** Giá hiển thị: "1.200.000đ" hoặc khoảng "1.200.000đ – 1.500.000đ" khi các phân loại khác giá */
export const priceRange = (p: Pick<Product, 'price_min' | 'price_max'>, fmt: (n: number) => string) =>
  p.price_min === p.price_max ? fmt(p.price_min) : `${fmt(p.price_min)} – ${fmt(p.price_max)}`

/** Tổng số còn lại (null = không giới hạn) — dùng cho nhãn "Còn 3" / "Hết hàng" */
export function productStock(p: Product): number | null {
  if (!p.variants.length) return p.stock
  if (p.variants.some((v) => v.stock === null)) return null
  return p.variants.reduce((s, v) => s + (v.stock ?? 0), 0)
}

/** CSV đơn hàng cho đối tác (mở bằng Excel) */
export function ordersCsv(orders: ShopOrder[]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const rows = orders.map((o) => [o.code, o.buyer_name, o.buyer_phone, o.ship_address,
    o.items.map((i) => `${i.title}${i.variant ? ` (${i.variant})` : ''} ×${i.qty}`).join('; '), o.amount_vnd, PAY_LABEL[o.payment_method],
    ORDER_STATUS[o.status].label, o.tracking_code ?? '', o.note ?? '', new Date(o.created_at).toLocaleString('vi-VN')])
  return '﻿sep=,\n' + [['Mã', 'Người nhận', 'Điện thoại', 'Địa chỉ', 'Sản phẩm', 'Tổng tiền (đ)', 'Thanh toán', 'Trạng thái', 'Mã vận đơn', 'Ghi chú', 'Thời gian'], ...rows]
    .map((r) => r.map(esc).join(',')).join('\n')
}
