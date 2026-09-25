'use client'

import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { NATIVE_CALLBACK } from '../model/socialAuth'

/** App cài: nhận vn.racehub.app://auth/callback?code=… từ trình duyệt hệ thống → đóng trình duyệt, đổi mã lấy phiên trong WebView */
export function NativeAuthBridge() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('App')) return
    let remove: (() => void) | undefined
    let alive = true
    void (async () => {
      const { App } = await import('@capacitor/app')
      const h = await App.addListener('appUrlOpen', ({ url }) => {
        if (!url.startsWith(NATIVE_CALLBACK)) return
        const search = url.slice(NATIVE_CALLBACK.length)
        if (Capacitor.isPluginAvailable('Browser')) void import('@capacitor/browser').then(({ Browser }) => Browser.close()).catch(() => undefined)
        window.location.replace(`/auth/callback${search.startsWith('?') ? search : ''}`)
      })
      if (alive) remove = () => void h.remove(); else void h.remove()
    })()
    return () => { alive = false; remove?.() }
  }, [])
  return null
}
