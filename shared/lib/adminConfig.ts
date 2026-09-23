// Đặt tại: src/shared/lib/adminConfig.ts

export const CONFIG_KEY_FEE_TIERS = 'challenge_fee_tiers';

export type Tier = {
  name: string;
  min: number;
  max: number | null;
  fee: number;
};

export const DEFAULT_TIERS: Tier[] = [
  { name: 'Kèo Nhỏ / Solo', min: 1, max: 10, fee: 20 },
  { name: 'Kèo Câu Lạc Bộ', min: 11, max: 50, fee: 50 },
  { name: 'Kèo Đại Hội Lớn', min: 51, max: null, fee: 150 },
];

// ---------- Phân quyền (một nguồn duy nhất: cột profiles.role) ----------
// Lưu ý: đây chỉ để ẩn/hiện giao diện. Quyền thật được kiểm tra trong DB (RLS + RPC).
export type Role = 'SYSTEM_ADMIN' | 'CLUB_ADMIN' | string;

export const isSystemAdmin = (profile?: { role?: Role | null } | null) =>
  profile?.role === 'SYSTEM_ADMIN';

export const canReviewActivities = (profile?: { role?: Role | null } | null) =>
  profile?.role === 'SYSTEM_ADMIN' || profile?.role === 'CLUB_ADMIN';

// ---------- Chuẩn hóa dữ liệu đọc từ DB ----------
// Chấp nhận cả dạng cũ (mảng, có "label") lẫn dạng mới ({ tiers: [...] }, có "name").
export function normalizeTiers(raw: unknown): Tier[] | null {
  let data: any = raw;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const list = Array.isArray(data) ? data : data?.tiers;
  if (!Array.isArray(list) || list.length === 0) return null;

  const result: Tier[] = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const min = Number(t?.min);
    const fee = Number(t?.fee);
    const max = t?.max === null || t?.max === undefined ? null : Number(t.max);
    if (!Number.isFinite(min) || !Number.isFinite(fee)) return null;
    if (max !== null && !Number.isFinite(max)) return null;
    result.push({
      name: String(t?.name ?? t?.label ?? DEFAULT_TIERS[i]?.name ?? `Bậc ${i + 1}`),
      min,
      max,
      fee,
    });
  }
  return result;
}

// ---------- Kiểm tra hợp lệ (server cũng kiểm tra lại) ----------
export function validateTiers(tiers: Tier[]): string | null {
  if (tiers.length === 0) return 'Cần ít nhất một bậc phí.';

  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const isLast = i === tiers.length - 1;
    const n = i + 1;

    if (!isLast) {
      if (t.max === null || !Number.isInteger(t.max)) return `${t.name}: hãy nhập số nguyên cho ô "Đến".`;
      if (t.max < t.min) return `${t.name}: "Đến" phải lớn hơn hoặc bằng "Từ" (${t.min}).`;
    } else if (t.max !== null) {
      return 'Bậc cuối phải để trống ô "Đến" (không giới hạn).';
    }

    if (!Number.isInteger(t.min) || t.min < 1) return `Bậc ${n}: "Từ" phải là số nguyên từ 1 trở lên.`;
    if (!Number.isInteger(t.fee) || t.fee < 0) return `${t.name}: phí phải là số nguyên từ 0 trở lên.`;
    if (i > 0 && t.fee < tiers[i - 1].fee) return `${t.name}: phí phải lớn hơn hoặc bằng phí của "${tiers[i - 1].name}".`;
  }
  return null;
}

// ---------- Hiển thị ----------
export function tierRange(t: Tier): string {
  if (!Number.isFinite(t.min)) return '—';
  if (t.max === null) return `từ ${t.min} VĐV trở lên`;
  if (!Number.isFinite(t.max)) return `từ ${t.min} VĐV`;
  return t.min === t.max ? `${t.min} VĐV` : `${t.min} – ${t.max} VĐV`;
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Giá trị mặc định cho <input type="datetime-local"> (giờ địa phương)
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
