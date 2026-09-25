import { Suspense } from 'react'
import { KnowledgeScreen } from '@/features/knowledge'

export default function LearnPage() {
  return <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-surface" />}><KnowledgeScreen /></Suspense>
}
