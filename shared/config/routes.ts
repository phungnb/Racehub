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
  plan: '/me/plan',
  insights: '/me/insights',
  shine: '/me/shine',
  vouchers: '/me/vouchers',
  invite: '/me/invite',
  market: '/market',
  marketMine: '/market/me',
  partner: (id: string) => `/market/${encodeURIComponent(id)}`,
  character: '/character',
  admin: '/admin',
  welcome: '/welcome',
  privacy: '/privacy',
  terms: '/terms',
  activity: (id: string) => `/activities/${encodeURIComponent(id)}`,
  learn: '/learn',
  learnArticle: (slug: string) => `/learn/${encodeURIComponent(slug)}`,
  learnStudio: '/learn/studio',
  nearby: '/nearby',
  nearbyConnections: '/nearby/connections',
  nearbyEvent: (id: string) => `/nearby/events/${encodeURIComponent(id)}`,
  races: '/races',
  race: (id: string) => `/races/${encodeURIComponent(id)}`,
} as const

/** Chỉ chấp nhận đường dẫn nội bộ cho tham số ?next= (chống open redirect) */
export function safeNext(next: string | null | undefined, fallback: string = routes.home) {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next
}
