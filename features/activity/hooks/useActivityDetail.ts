'use client'

import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getActivityDetail, requestActivityEnrich } from '../api/activities'

export const activityKeys = { detail: (id: string) => ['activity', id] as const }

/** Chi tiết bài chạy; bài Strava chưa có từng km thì tự nhờ server lấy thêm (một lần) rồi tải lại */
export function useActivityDetail(id: string) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: activityKeys.detail(id), queryFn: () => getActivityDetail(id) })
  const asked = useRef(false)
  const needs = q.data?.needs_detail
  useEffect(() => {
    if (!needs || asked.current) return
    asked.current = true
    void requestActivityEnrich(id).then((ok) => { if (ok) void qc.invalidateQueries({ queryKey: activityKeys.detail(id) }) }).catch(() => {})
  }, [needs, id, qc])
  return q
}
