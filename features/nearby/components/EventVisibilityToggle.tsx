'use client'

import { Globe2, Lock } from 'lucide-react'
import { Field } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'

export type EventVisibility = 'CLUB' | 'PUBLIC'

/** Chọn ai thấy sự kiện CLB: chỉ thành viên, hay công khai ở Quanh đây (cần toạ độ điểm hẹn nơi công cộng) */
export function EventVisibilityToggle({ value, onChange, hasCoords }: { value: EventVisibility; onChange: (v: EventVisibility) => void; hasCoords: boolean }) {
  const opts = [
    { v: 'CLUB' as const, icon: Lock, label: 'Chỉ thành viên', hint: 'Như trước giờ' },
    { v: 'PUBLIC' as const, icon: Globe2, label: 'Công khai', hint: 'Runner quanh đây thấy & đăng ký' },
  ]
  return (
    <Field label="Ai thấy buổi chạy" hint={value === 'PUBLIC' && !hasCoords ? 'Buổi chạy công khai cần toạ độ điểm hẹn (nơi công cộng).' : undefined}>
      <div className="grid grid-cols-2 gap-2">
        {opts.map((o) => (
          <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}
            className={cn('rounded-xl border p-3 text-left', value === o.v ? 'border-brand bg-brand/10' : 'border-border')}>
            <span className="flex items-center gap-1.5 text-sm font-semibold"><o.icon className="size-4" aria-hidden />{o.label}</span>
            <span className="block text-xs text-fg-muted">{o.hint}</span>
          </button>
        ))}
      </div>
    </Field>
  )
}
