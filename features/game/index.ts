// Cổng công khai của module game. Code ngoài module chỉ import từ '@/features/game'.
export { GameHub } from './components/GameHub'
export { RewardCascade } from './components/RewardCascade'
export { BadgeGrid } from './components/BadgeGrid'
export { WalletView } from './components/WalletView'
export { CheerButton } from './components/CheerButton'
export { useActivityRewards, useMarkSeen } from './hooks/useGame'
export type { GameEvent } from './model/game'
