import jobsData from '../data/jobs.json';
import facilitiesData from '../data/facilities.json';
import type { Facility, Floor, Job } from '../types/models';

export const JOBS = jobsData as Job[];
export const FACILITIES = facilitiesData as Facility[];

const jobIndex = new Map(JOBS.map((j) => [j.id, j]));

export function jobById(id: string): Job | undefined {
  return jobIndex.get(id);
}

/** 分類清單，依 CSV 首次出現順序 */
export const CATEGORIES: string[] = [...new Set(JOBS.map((j) => j.mapCategory))];

export const FLOORS: Floor[] = [1, 2];

export type EconomyKind = 'earn' | 'spend' | 'twd' | 'unknown';

export function economyKind(job: Pick<Job, 'kidzoDelta' | 'ntdFee'>): EconomyKind {
  if (job.ntdFee !== null) return 'twd';
  if (job.kidzoDelta === null) return 'unknown';
  return job.kidzoDelta >= 0 ? 'earn' : 'spend';
}

/** 一根圖釘＝一個地圖編號（同館多職業共用） */
export interface MapPin {
  key: string;
  mapNo: number | null;
  floor: Floor;
  x: number;
  y: number;
  jobs: Job[];
}

/** 樓層或座標不明的職業不放圖釘 */
export function pinsForFloor(floor: Floor): MapPin[] {
  const groups = new Map<string, MapPin>();
  for (const j of JOBS) {
    if (j.floor !== floor || j.x === null || j.y === null) continue;
    const key = j.mapNo !== null ? `no-${j.mapNo}` : `job-${j.id}`;
    const pin = groups.get(key);
    if (pin) pin.jobs.push(j);
    else groups.set(key, { key, mapNo: j.mapNo, floor, x: j.x, y: j.y, jobs: [j] });
  }
  return [...groups.values()].sort((a, b) => (a.mapNo ?? 999) - (b.mapNo ?? 999));
}

export function facilitiesForFloor(floor: Floor): Facility[] {
  return FACILITIES.filter((f) => f.floor === floor);
}

/** 不分大小寫、忽略空白；比對職業、場館、品牌、分類，或地圖編號（「7」「#7」「7號」） */
export function matchesQuery(job: Job, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return true;
  const no = /^#?(\d{1,2})號?$/.exec(q);
  if (no) return job.mapNo === Number(no[1]);
  const hay = [job.nameZh, job.venueZh, job.sponsor ?? '', job.mapCategory]
    .join('|')
    .toLowerCase()
    .replace(/\s+/g, '');
  return hay.includes(q);
}

export type PinKind = 'done' | 'partial' | 'open' | 'locked';

export interface PinState {
  kind: PinKind;
  /** 有任一職業標「待確認」或年齡未知 */
  pending: boolean;
  doneCount: number;
  total: number;
}

/**
 * 圖釘顏色：
 * - done：此館所有職業都完成（印章）
 * - partial：一館多職業、部分完成
 * - open：還有可參加的職業
 * - locked：全部年齡未到
 */
export function pinState(
  pin: Pick<MapPin, 'jobs'>,
  isOpen: (job: Job) => boolean,
  isDone: (job: Job) => boolean,
): PinState {
  const total = pin.jobs.length;
  const doneCount = pin.jobs.filter(isDone).length;
  const pending = pin.jobs.some((j) => j.flag !== null || (j.minAge === null && j.maxAge === null));
  let kind: PinKind;
  if (doneCount === total) kind = 'done';
  else if (doneCount > 0) kind = 'partial';
  else if (pin.jobs.some(isOpen)) kind = 'open';
  else kind = 'locked';
  return { kind, pending, doneCount, total };
}

/** 服務設施（廁所、ATM、醫療室、AED）：沒有字母編號、類型為服務設施 */
export function isServiceFacility(f: Facility): boolean {
  return f.letter === null && f.facilityType === '服務設施';
}
