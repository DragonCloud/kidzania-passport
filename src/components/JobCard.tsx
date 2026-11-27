import { Link } from 'react-router-dom';
import { formatAgeReq, formatFloor } from '../lib/format';
import type { JobRow } from '../lib/filters';
import { EconomyTag } from './EconomyTag';
import { MapNoBadge } from './Badge';
import { JobStatusBadges } from './JobBadges';
import { IconStamp } from './icons';

export function JobCard({ row }: { row: JobRow }) {
  const { job, eligibility, stats } = row;
  const locked = eligibility === 'locked' || eligibility === 'tooOld';
  return (
    <Link
      to={`/job/${job.id}`}
      className={`relative flex gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-ink/5 transition active:scale-[0.99] ${locked ? 'opacity-60' : ''}`}
    >
      <MapNoBadge mapNo={job.mapNo} floor={job.floor} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base leading-tight font-bold">{job.nameZh}</h3>
          {stats && <IconStamp className="h-6 w-6 shrink-0 -rotate-12 text-emerald-600" aria-label="已完成" />}
        </div>
        <p className="mt-0.5 truncate text-xs text-ink/60">
          {formatFloor(job.floor)}・{job.venueZh}
          {job.sponsor ? `・${job.sponsor}` : ''}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          <EconomyTag job={job} />
          <span className="text-xs leading-5 text-ink/55">
            {[eligibility === 'unknown' ? null : formatAgeReq(job), job.durationMin !== null ? `${job.durationMin} 分` : null]
              .filter(Boolean)
              .join('・')}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1 empty:hidden">
          <JobStatusBadges job={job} eligibility={eligibility} stats={stats} />
        </div>
      </div>
    </Link>
  );
}
