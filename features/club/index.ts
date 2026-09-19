// features/club/index.ts
// Cổng xuất công khai của tính năng Club.
// Từ NGOÀI feature này (app/, hoặc feature khác), luôn import qua đây:
//   import { ClubTab, getClub } from '@/features/club'
// Bên TRONG feature này (giữa các file trong club/), dùng import tương đối.

export { default as ClubTab } from './components/ClubTab'
export { default as ClubMembersManager } from './components/ClubMembersManager'
export { default as ClubSettings, ClubAvatar } from './components/ClubSettings'
export { default as ClubAdminPanel } from './components/ClubAdminPanel'
export { default as ClubActivities } from './components/ClubActivities'
export { default as ClubDashboardWithLeaderboard } from './components/ClubDashboardWithLeaderboard'

export * from './api'