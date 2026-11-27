import type { Job } from '../types/models';

/** 'YYYY-MM-DD'（裝置當地日期） */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseISODate(s: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return { y, m, d };
}

export function isValidBirthday(birthday: string, today: string = todayISO()): boolean {
  return parseISODate(birthday) !== null && birthday <= today;
}

export interface AgeParts {
  years: number;
  months: number;
}

/**
 * 滿歲與月數。2/29 生日在平年視為 3/1 才滿歲（月份算法同理：日數未到不算滿月）。
 * 生日在未來或格式錯誤時回傳 null。
 */
export function ageParts(birthday: string, today: string = todayISO()): AgeParts | null {
  const b = parseISODate(birthday);
  const t = parseISODate(today);
  if (!b || !t || birthday > today) return null;
  let months = (t.y - b.y) * 12 + (t.m - b.m);
  if (t.d < b.d) months -= 1;
  return { years: Math.floor(months / 12), months: months % 12 };
}

export function fullYears(birthday: string, today: string = todayISO()): number | null {
  return ageParts(birthday, today)?.years ?? null;
}

/** 「4 歲 7 個月」 */
export function formatAge(parts: AgeParts | null): string {
  if (!parts) return '—';
  return parts.months === 0 ? `${parts.years} 歲` : `${parts.years} 歲 ${parts.months} 個月`;
}

/**
 * - eligible：年齡符合
 * - unknown：官方年齡空白 → 仍列在「可參加」，顯示「年齡未知・待確認」
 * - locked：年齡未到（顯示「x 歲解鎖」）
 * - tooOld：超過 maxAge
 * - noProfile：尚未設定生日，無法判斷
 */
export type Eligibility = 'eligible' | 'unknown' | 'locked' | 'tooOld' | 'noProfile';

export function eligibility(job: Pick<Job, 'minAge' | 'maxAge'>, age: number | null): Eligibility {
  if (job.minAge === null && job.maxAge === null) return 'unknown';
  if (age === null) return 'noProfile';
  if (job.minAge !== null && age < job.minAge) return 'locked';
  if (job.maxAge !== null && age > job.maxAge) return 'tooOld';
  return job.minAge === null ? 'unknown' : 'eligible';
}

/** 總覽「現在可以玩」濾鏡：eligible 與 unknown 都算 */
export function canJoinNow(e: Eligibility): boolean {
  return e === 'eligible' || e === 'unknown';
}
