// Nguồn duy nhất cho đường dẫn trong app
export const routes = {
  home: '/feed',
  login: '/login',
  resetPassword: '/reset-password',
  feed: '/feed',
  challenges: '/challenges',
  run: '/run',
  clubs: '/clubs',
  club: (id: string) => `/clubs?clubId=${encodeURIComponent(id)}`,
  me: '/me',
  admin: '/admin',
} as const

/** Chỉ chấp nhận đường dẫn nội bộ cho tham số ?next= (chống open redirect) */
export function safeNext(next: string | null | undefined, fallback: string = routes.home) {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next
}
