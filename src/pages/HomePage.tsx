import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChildSetupCard } from '../components/ChildSetupCard';
import { FilterSheet } from '../components/FilterSheet';
import { IconFilter, IconSearch } from '../components/icons';
import { JobCard } from '../components/JobCard';
import { SyncBadge } from '../components/sync/SyncBadge';
import { PassportExpiryNote } from '../components/passport/StampProgressCard';
import { useChild } from '../hooks/useChild';
import { useCompletions } from '../hooks/useCompletions';
import { canJoinNow, eligibility, formatAge } from '../lib/age';
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  filterJobs,
  filtersFromParams,
  filtersToParams,
  type JobFilters,
} from '../lib/filters';
import { JOBS } from '../lib/jobs';

/**
 * 點進職業詳情時記住總覽的捲動位置，返回時還原。
 * 在點擊當下記錄（而非監聽 scroll），避免換頁時頁面變短觸發的捲動事件蓋掉位置。
 */
let savedScrollY = 0;

export default function HomePage() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { loaded: childLoaded, child, displayName, age, years } = useChild();
  const { loaded: completionsLoaded, stats } = useCompletions();
  // 生日與完成紀錄從 IndexedDB 讀完前不排清單，避免年齡未到的職業先出現再被移到最後
  const ready = childLoaded && completionsLoaded;

  const update = useCallback(
    (patch: Partial<JobFilters>) => setParams(filtersToParams({ ...filters, ...patch }), { replace: true }),
    [filters, setParams],
  );

  const rows = useMemo(() => filterJobs(JOBS, filters, years, stats), [filters, years, stats]);
  const joinableCount = useMemo(
    () => (years === null ? JOBS.length : JOBS.filter((j) => canJoinNow(eligibility(j, years))).length),
    [years],
  );
  const collected = stats.size;
  const advanced = activeFilterCount(filters);
  const needsSetup = childLoaded && !child.birthday;

  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    window.scrollTo(0, savedScrollY);
  }, [ready]);

  return (
    <main
      className="mx-auto max-w-md px-4 pt-5 pb-28"
      onClickCapture={() => {
        savedScrollY = window.scrollY;
      }}
    >
      <header>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold tracking-widest text-brand">KIDZANIA TAIPEI</p>
          <SyncBadge />
        </div>
        <h1 className="mt-0.5 text-2xl font-black">{child.name ? `${child.name}的職業護照` : '職業護照'}</h1>
        {age && (
          <p className="mt-1 text-sm text-ink/65">
            {displayName}現在 <b className="text-ink">{formatAge(age)}</b>，可參加 {joinableCount} 項
          </p>
        )}
        <PassportExpiryNote />
      </header>

      {needsSetup && (
        <div className="mt-4">
          <ChildSetupCard child={child} />
        </div>
      )}

      <section className="mt-4 rounded-3xl bg-ink p-4 text-white shadow-md" aria-label="收集進度">
        <div className="flex items-end justify-between">
          <span className="text-sm text-white/70">已收集職業</span>
          <span className="tabular-nums">
            <b className="text-3xl font-black">{collected}</b>
            <span className="text-white/60"> / {JOBS.length}</span>
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(collected / JOBS.length) * 100}%` }} />
        </div>
      </section>

      <div className="sticky top-0 z-20 -mx-4 mt-4 bg-paper/95 px-4 pt-2 pb-3 backdrop-blur safe-top">
        <label className="relative block">
          <span className="sr-only">搜尋</span>
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-ink/40" />
          <input
            type="search"
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="搜尋職業、場館、品牌或編號"
            enterKeyHint="search"
            className="w-full rounded-2xl bg-white py-3 pr-3 pl-10 text-base shadow-sm ring-1 ring-ink/10 outline-none focus:ring-2 focus:ring-brand"
          />
        </label>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex flex-1 rounded-2xl bg-ink/[0.06] p-1" role="tablist" aria-label="顯示範圍">
            {(
              [
                ['now', years === null ? '全部可玩' : `現在可以玩`],
                ['all', `全部 ${JOBS.length}`],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={filters.view === v}
                onClick={() => update({ view: v })}
                className={`flex-1 rounded-xl py-2 text-sm font-bold transition ${
                  filters.view === v ? 'bg-white text-ink shadow-sm' : 'text-ink/55'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className={`relative flex h-11 items-center gap-1 rounded-2xl px-3 text-sm font-bold ring-1 ${
              advanced ? 'bg-ink text-white ring-ink' : 'bg-white ring-ink/10'
            }`}
          >
            <IconFilter className="h-5 w-5" />
            篩選{advanced ? ` ${advanced}` : ''}
          </button>
        </div>
      </div>

      <p className="mb-2 text-xs text-ink/55" aria-live="polite">
        共 {rows.length} 項
        {(advanced > 0 || filters.q) && (
          <button type="button" className="ml-2 font-bold text-brand underline" onClick={() => setParams(filtersToParams({ ...DEFAULT_FILTERS, view: filters.view }), { replace: true })}>
            清除條件
          </button>
        )}
      </p>

      {!ready ? (
        <div className="h-[60vh]" aria-busy="true" />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center text-ink/60 ring-1 ring-ink/5">沒有符合條件的職業</div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => (
            <li key={row.job.id}>
              <JobCard row={row} />
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-center text-[11px] leading-relaxed text-ink/45">
        非官方家庭紀錄工具。年齡、時長、kidZos 等實際條件以園區現場公告與官方網站為準。
      </p>

      <FilterSheet
        open={sheetOpen}
        filters={filters}
        resultCount={rows.length}
        onChange={update}
        onReset={() => setParams(filtersToParams({ ...DEFAULT_FILTERS, q: filters.q, view: filters.view }), { replace: true })}
        onClose={() => setSheetOpen(false)}
      />
    </main>
  );
}
