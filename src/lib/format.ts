import type { Job } from '../types/models';

const nf = new Intl.NumberFormat('zh-TW');

/** +10 → "+10"、-5 → "−5"（全形減號較易讀） */
export function signed(n: number): string {
  if (n > 0) return `+${nf.format(n)}`;
  if (n < 0) return `−${nf.format(Math.abs(n))}`;
  return '0';
}

export function formatKidzos(n: number, withSign = true): string {
  return `${withSign ? signed(n) : nf.format(n === 0 ? 0 : n)} kidZos`;
}

export function formatNtd(n: number): string {
  return `NT$${nf.format(n === 0 ? 0 : n)}`; // 避免 -0 顯示成 NT$-0
}

/** 卡片用的經濟標籤文字；官方未列時回 null（不自行補值） */
export function economyLabel(job: Pick<Job, 'kidzoDelta' | 'ntdFee'>): string | null {
  if (job.ntdFee !== null) return `自費 ${formatNtd(job.ntdFee)}`;
  if (job.kidzoDelta !== null) return job.kidzoDelta >= 0 ? `賺 ${formatKidzos(job.kidzoDelta)}` : `付 ${formatKidzos(-job.kidzoDelta, false)}`;
  return null;
}

export function formatAgeReq(job: Pick<Job, 'minAge' | 'maxAge'>): string {
  const { minAge, maxAge } = job;
  if (minAge === null && maxAge === null) return '年齡未知';
  if (minAge !== null && maxAge !== null) return `${minAge}–${maxAge} 歲`;
  if (minAge !== null) return `${minAge} 歲以上`;
  return `${maxAge} 歲以下`;
}

export function formatFloor(floor: number | null): string {
  return floor === null ? '樓層未知' : `${floor}F`;
}

/** 2026/11/27（五） */
export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).format(ms);
}

/** 2026/11/27 14:05 */
export function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(ms);
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/** ms → <input type="datetime-local"> 的值（當地時間） */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** <input type="datetime-local"> 的值 → ms；格式錯誤回 null */
export function fromLocalInput(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  const ms = new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** ms → 'YYYY-MM-DD'（當地日期） */
export function localDateISO(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'YYYY-MM-DD' → 2026/11/27（五） */
export function formatISODate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return formatDate(new Date(y!, (m ?? 1) - 1, d ?? 1).getTime());
}

/** 印章上的日期 2026.11.27 */
export function stampDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}
