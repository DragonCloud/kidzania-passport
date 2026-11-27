import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, filterJobs, filtersFromParams, filtersToParams, type JobFilters } from './filters';
import { JOBS } from './jobs';

const none = new Map();
const f = (patch: Partial<JobFilters>): JobFilters => ({ ...DEFAULT_FILTERS, ...patch });

describe('filterJobs', () => {
  it('預設「現在可以玩」：4 歲 26 項', () => {
    expect(filterJobs(JOBS, DEFAULT_FILTERS, 4, none)).toHaveLength(26);
  });
  it('全部：43 項，年齡未到排後面', () => {
    const rows = filterJobs(JOBS, f({ view: 'all' }), 4, none);
    expect(rows).toHaveLength(43);
    expect(rows.at(-1)!.eligibility).toBe('locked');
    expect(rows[0]!.eligibility).not.toBe('locked');
  });
  it('未設定生日不篩年齡', () => {
    expect(filterJobs(JOBS, DEFAULT_FILTERS, null, none)).toHaveLength(43);
  });
  it('樓層、收支、待確認、完成狀態', () => {
    expect(filterJobs(JOBS, f({ view: 'all', floor: 2 }), 4, none).every((r) => r.job.floor === 2)).toBe(true);
    expect(filterJobs(JOBS, f({ view: 'all', econ: ['twd'] }), 4, none).map((r) => r.job.id)).toEqual(['job-yakiniku']);
    expect(filterJobs(JOBS, f({ pendingOnly: true }), 4, none)).toHaveLength(2);
    const stats = new Map([['job-vet', { count: 1, lastAt: 1 }]]);
    expect(filterJobs(JOBS, f({ status: 'done' }), 4, stats).map((r) => r.job.id)).toEqual(['job-vet']);
    expect(filterJobs(JOBS, f({ status: 'todo' }), 4, stats)).toHaveLength(25);
  });
  it('URL 參數來回轉換', () => {
    const x = f({ q: '醫', view: 'all', floor: 1, econ: ['earn', 'spend'], cat: '健康照護業', status: 'todo', pendingOnly: true });
    expect(filtersFromParams(filtersToParams(x))).toEqual(x);
    expect(filtersFromParams(new URLSearchParams('floor=9&econ=bad'))).toEqual(DEFAULT_FILTERS);
  });
});
