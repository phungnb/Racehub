export const victoryKeys = {
  sources: ['victory', 'sources'] as const,
  mine: ['victory', 'mine'] as const,
  facts: (kind: string, ref: string, user: string | null) => ['victory', 'facts', kind, ref, user ?? ''] as const,
  participants: (challenge: string) => ['victory', 'participants', challenge] as const,
}
