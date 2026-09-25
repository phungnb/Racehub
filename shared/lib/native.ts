// RaceHub chạy trong app cài từ App Store / Google Play (vỏ Capacitor, xem capacitor.config.ts) hay trên trình duyệt.
// Trong app, trang web vẫn là một — chỉ khác ở chỗ gọi được tính năng native (GPS nền…).
import { Capacitor } from '@capacitor/core'

export const isNativeApp = () => typeof window !== 'undefined' && Capacitor.isNativePlatform()
export const nativePlatform = () => (isNativeApp() ? (Capacitor.getPlatform() as 'ios' | 'android') : null)
