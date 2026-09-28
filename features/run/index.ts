// Cổng công khai của module run. Code ngoài module chỉ import từ '@/features/run'.
export { RunScreen } from './components/RunScreen'
export { PendingRunSync } from './components/PendingRunSync'
export { GpsQualityCard, type GpsQualityData } from './components/GpsQuality'
export { QA_SCENARIOS, qaLabel, errorPct, errorTone, badPct } from './model/qa'
export { useRunActive } from './hooks/useRunActive'
