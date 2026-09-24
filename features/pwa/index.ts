// Cổng công khai của module pwa (cài app, service worker, trạng thái mạng). Code ngoài module chỉ import từ '@/features/pwa'.
export { PwaBoot } from './components/PwaBoot'
export { OfflineBanner } from './components/OfflineBanner'
export { InstallCard, useInstallAction, useInstallState } from './components/InstallApp'
export { isStandalone, detectPlatform } from './model/pwa'
