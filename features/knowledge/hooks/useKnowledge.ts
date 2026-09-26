'use client'

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../api/knowledgeApi'

export const knowledgeKeys = {
  home: ['knowledge', 'home'] as const,
  list: (f: api.ListFilters) => ['knowledge', 'list', f] as const,
  article: (slug: string) => ['knowledge', 'article', slug] as const,
  role: ['knowledge', 'role'] as const,
}

export const useKnowledgeHome = () => useQuery({ queryKey: knowledgeKeys.home, queryFn: api.knowledgeHome, staleTime: 5 * 60_000 })
export const useArticle = (slug: string) => useQuery({ queryKey: knowledgeKeys.article(slug), queryFn: () => api.knowledgeArticle(slug), staleTime: 60_000 })
export const useContentRole = () => useQuery({ queryKey: knowledgeKeys.role, queryFn: api.myContentRole, staleTime: 10 * 60_000 })
export function useArticleList(f: api.ListFilters) {
  return useInfiniteQuery({
    queryKey: knowledgeKeys.list(f),
    queryFn: ({ pageParam }) => api.knowledgeList(f, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (pages.length * 20 < last.total ? pages.length * 20 : undefined),
  })
}

/** Lưu / bỏ lưu → làm mới trang chủ Knowledge + danh sách */
export function useBookmark() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => api.knowledgeBookmark(id, on),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['knowledge'] }),
  })
}
