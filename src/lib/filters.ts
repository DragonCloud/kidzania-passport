import type { Floor, Job } from '../types/models';
import { canJoinNow, eligibility, type Eligibility } from './age';
import type { JobStats } from './completions';
import { economyKind, matchesQuery, type EconomyKind } from './jobs';

export type View = 'now' | 'all';
export type Status = 'todo' | 'done';

export interface JobFilters {
  q: string;
  view: View;
  floor: Floor | null;
  econ: EconomyKind[];
  cat: string | null;
  status: Status | null;
  pendingOnly: boolean;
}

export const DEFAULT_FILTERS: JobFilters = {
  q: '',
  view: 'now',
  floor: null,
  econ: [],
  cat: null,
  status: null,
  pendingOnly: false,
};

const ECON: EconomyKind[] = ['earn', 'spend', 'twd', 'unknown'];

/** URL 查詢字串 ⇄ 篩選條件（返回總覽時保留篩選） */
export function filtersFromParams(p: URLSearchParams): JobFilters {
  const floor = p.get('floor');
  const status = p.get('status');
  return {
    q: p.get('q') ?? '',
    view: p.get('view') === 'all' ? 'all' : 'now',
    floor: floor === '1' ? 1 : floor === '2' ? 2 : null,
    econ: (p.get('econ') ?? '').split(',').filter((x): x is EconomyKind => (ECON as string[]).includes(x)),
    cat: p.get('cat') || null,
    status: status === 'todo' || status === 'done' ? status : null,
    pendingOnly: p.get('pending') === '1',
  };
}

export function filtersToParams(f: JobFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.view === 'all') p.set('view', 'all');
  if (f.floor) p.set('floor', String(f.floor));
  if (f.econ.length) p.set('econ', f.econ.join(','));
  if (f.cat) p.set('cat', f.cat);
  if (f.status) p.set('status', f.status);
  if (f.pendingOnly) p.set('pending', '1');
  return p;
}

/** 進階篩選（不含搜尋字與「現在可以玩」）套用了幾項，給篩選按鈕顯示數字 */
export function activeFilterCount(f: JobFilters): number {
  return [f.floor !== null, f.econ.length > 0, f.cat !== null, f.status !== null, f.pendingOnly].filter(Boolean).length;
}

export interface JobRow {
  job: Job;
  eligibility: Eligibility;
  stats: JobStats | undefined;
}

/**
 * 依條件篩選並排序：
 * - view=now：只留可參加（含年齡未知）；未設定生日時不篩年齡
 * - 排序：可參加在前、年齡未到在後；同組依地圖編號
 */
export function filterJobs(jobs: Job[], f: JobFilters, age: number | null, stats: Map<string, JobStats>): JobRow[] {
  const rows: JobRow[] = [];
  for (const job of jobs) {
    const e = eligibility(job, age);
    const s = stats.get(job.id);
    if (f.view === 'now' && age !== null && !canJoinNow(e)) continue;
    if (!matchesQuery(job, f.q)) continue;
    if (f.floor !== null && job.floor !== f.floor) continue;
    if (f.econ.length && !f.econ.includes(economyKind(job))) continue;
    if (f.cat !== null && job.mapCategory !== f.cat) continue;
    if (f.status === 'done' && !s) continue;
    if (f.status === 'todo' && s) continue;
    if (f.pendingOnly && !job.flag) continue;
    rows.push({ job, eligibility: e, stats: s });
  }
  const rank = (e: Eligibility) => (canJoinNow(e) || e === 'noProfile' ? 0 : 1);
  return rows.sort((a, b) => rank(a.eligibility) - rank(b.eligibility) || (a.job.mapNo ?? 999) - (b.job.mapNo ?? 999));
}
