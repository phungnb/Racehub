// Cổng công khai của module system (thông báo hệ thống, nhật ký lỗi người dùng). Code ngoài module chỉ import từ '@/features/system'.
export { SystemNoticeBanner } from './components/SystemNoticeBanner'
export { SystemNoticeEditor } from './components/SystemNoticeEditor'
export { ClientErrorsPanel } from './components/ClientErrorsPanel'
export { FeatureGate } from './components/FeatureGate'
export { PurchaseOnly } from './components/PurchaseOnly'
export { useOpsPolicy, useFeature, useCanPurchase, useIsNativeApp, usePublishOps, useConfigHistory, useRollbackConfig } from './hooks/useSystem'
