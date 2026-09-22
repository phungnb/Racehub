export interface ProfileData {
  id: string;
  display_name: string;
  xu: number;
  xp: number;
  level: number;
}

export interface RunnerStatsData {
  totalKm: number;
  challengesCount: number;
  achievementsCount: number;
  xp: number;
}

export interface AchievementData {
  id: string;
  title: string;
  icon: string;
  status: 'unlocked' | 'locked';
}

export interface ActivityData {
  title: string;
  distance: string;
  pace: string;
  date: string;
}
