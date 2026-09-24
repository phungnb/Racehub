'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { publicEnv } from '@/shared/config/env'
import { deletePushSubscription, savePushSubscription } from '../api/pushApi'
import { pushSupport, urlBase64ToUint8Array, type PushSupport } from '../model/push'

export const pushKeys = { settings: ['push-settings'] as const }

const noop = () => () => {}
function readSupport(): PushSupport {
  const ua = navigator.userAgent
  return pushSupport({
    hasKey: !!publicEnv.vapidPublicKey,
    production: process.env.NODE_ENV === 'production',
    hasSW: 'serviceWorker' in navigator,
    hasPush: 'PushManager' in window && 'Notification' in window,
    ios: /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1),
    standalone: window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
  })
}
export const usePushSupport = () => useSyncExternalStore(noop, readSupport, () => 'unsupported' as PushSupport)

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

async function subscribeThisDevice(): Promise<PushSubscription> {
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicEnv.vapidPublicKey) })
  await savePushSubscription(sub)
  return sub
}

/** Gỡ thiết bị này khỏi danh sách nhận push (gọi trước khi đăng xuất). Không bao giờ ném lỗi. */
export async function unsubscribeThisDevice() {
  try {
    if (!('serviceWorker' in navigator) || !(await navigator.serviceWorker.getRegistration())) return
    const sub = await currentSubscription()
    if (!sub) return
    await deletePushSubscription(sub.endpoint).catch(() => {})
    await sub.unsubscribe()
  } catch { /* bỏ qua */ }
}

/** Trạng thái push của thiết bị này + bật/tắt */
export function usePush() {
  const support = usePushSupport()
  const qc = useQueryClient()
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification === 'undefined' ? 'default' : Notification.permission)
  const [subscribed, setSubscribed] = useState<boolean | null>(null)

  useEffect(() => {
    if (support !== 'ok') return
    let alive = true
    currentSubscription().then((s) => { if (alive) setSubscribed(!!s) }).catch(() => { if (alive) setSubscribed(false) })
    return () => { alive = false }
  }, [support])

  const enable = useCallback(async () => {
    const p = await Notification.requestPermission()
    setPermission(p)
    if (p !== 'granted') return false
    await subscribeThisDevice()
    setSubscribed(true)
    void qc.invalidateQueries({ queryKey: pushKeys.settings })
    return true
  }, [qc])

  const disable = useCallback(async () => {
    await unsubscribeThisDevice()
    setSubscribed(false)
    void qc.invalidateQueries({ queryKey: pushKeys.settings })
  }, [qc])

  return { support, permission, subscribed: support === 'ok' ? subscribed : false, enable, disable }
}

/**
 * Chạy nền trong khung app: người đã cho phép thông báo thì đồng bộ lại đăng ký với tài khoản đang đăng nhập
 * (đổi tài khoản trên cùng máy, trình duyệt đổi khóa, cài lại app).
 */
export function usePushSync(userId: string | null) {
  const support = usePushSupport()
  useEffect(() => {
    if (!userId || support !== 'ok' || Notification.permission !== 'granted') return
    void subscribeThisDevice().catch(() => {})
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'push-resubscribe') void subscribeThisDevice().catch(() => {}) }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [userId, support])
}
