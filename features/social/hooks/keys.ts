export const socialKeys = {
  status: (user: string) => ['social', 'status', user] as const,
  list: (user: string, kind: string) => ['social', 'list', user, kind] as const,
  feed: ['social', 'feed'] as const,
  suggestions: ['social', 'suggestions'] as const,
  inbox: ['social', 'inbox'] as const,
  unread: ['social', 'unread'] as const,
  thread: (user: string) => ['social', 'thread', user] as const,
}
