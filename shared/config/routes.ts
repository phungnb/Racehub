// Nguồn duy nhất cho đường dẫn trong app
export const routes = {
  home: '/feed',
  login: '/login',
  resetPassword: '/reset-password',
  feed: '/feed',
  challenges: '/challenges',
  challenge: (id: string, code?: string | null) => `/challenges/${encodeURIComponent(id)}${code ? `?code=${encodeURIComponent(code)}` : ''}`,
  newChallenge: '/challenges/new',
  run: '/run',
  clubs: '/clubs',
  club: (id: string) => `/clubs/${encodeURIComponent(id)}`,
  clubTab: (id: string, tab: 'chat' | 'challenges' | 'leaderboard' | 'members' | 'treasury' | 'settings') => `/clubs/${encodeURIComponent(id)}/${tab}`,
  notifications: '/notifications',
  me: '/me',
  settings: '/me/settings',
  wallet: '/wallet',
  character: '/character',
  admin: '/admin',
  welcome: '/welcome',
  activity: (id: string) => `/activities/${encodeURIComponent(id)}`,
} as const

/** Chỉ chấp nhận đường dẫn nội bộ cho tham số ?next= (chống open redirect) */
export function safeNext(next: string | null | undefined, fallback: string = routes.home) {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next
}
