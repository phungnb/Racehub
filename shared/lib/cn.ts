import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Gộp className, class sau ghi đè class trước (vd. `cn('p-2', cond && 'p-4')`). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
