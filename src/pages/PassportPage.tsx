import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyStamp, Stamp, stampTilt } from '../components/Stamp';
import { PhotoViewer } from '../components/PhotoViewer';
import { useBlobUrl } from '../hooks/useBlobUrl';
import { useChild } from '../hooks/useChild';
import { useCompletions } from '../hooks/useCompletions';
import { useLedger } from '../hooks/useLedger';
import { useToday } from '../hooks/useToday';
import { useVisits } from '../hooks/useVisits';
import { eligibility, formatAge } from '../lib/age';
import { formatISODate, formatNtd, localDateISO } from '../lib/format';
import { JOBS } from '../lib/jobs';
import type { Completion } from '../types/models';

function Thumb({ c, onOpen }: { c: Completion; onOpen: (c: Completion) => void }) {
  const url = useBlobUrl(c.thumbBlobId);
  return (
    <button type="button" onClick={() => onOpen(c)} className="aspect-square overflow-hidden rounded-xl bg-ink/5" aria-label="看照片">
      {url && <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />}
    </button>
  );
}

export default function PassportPage() {
  const { child, age, years } = useChild();
  const { completions, stats } = useCompletions();
  const visits = useVisits();
  const today = useToday();
  const [wall, setWall] = useState<'all' | 'done'>('all');
  const [viewing, setViewing] = useState<Completion | null>(null);

  const walletVisit = visits.find((v) => v.visitDate === today) ?? visits[0];
  const { kidzos } = useLedger(walletVisit?.id ?? '__none__');
  const { twdSpent: twdAll } = useLedger();

  const albums = useMemo(() => {
    const groups = new Map<string, Completion[]>();
    for (const c of completions) {
      if (!c.thumbBlobId) continue;
      const d = localDateISO(c.completedAt);
      groups.set(d, [...(groups.get(d) ?? []), c]);
    }
    return [...groups.entries()];
  }, [completions]);

  const wallJobs = wall === 'done' ? JOBS.filter((j) => stats.has(j.id)) : JOBS;

  return (
    <main className="mx-auto max-w-md px-4 pt-5 pb-28">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs font-bold tracking-widest text-brand">PASSPORT</p>
          <h1 className="mt-0.5 text-2xl font-black">{child.name ? `${child.name}的護照` : '我的護照'}</h1>
          {age && <p className="mt-0.5 text-sm text-ink/60">{formatAge(age)}</p>}
        </div>
      </header>

      <section className="mt-4 grid grid-cols-3 gap-2 text-center" aria-label="成就">
        {[
          ['職業', `${stats.size}`, `/ ${JOBS.length}`],
          ['蓋章', `${completions.length}`, '次'],
          ['入園', `${visits.length}`, '次'],
        ].map(([label, n, unit]) => (
          <div key={label} className="rounded-2xl bg-white py-3 shadow-sm ring-1 ring-ink/5">
            <p className="text-xs text-ink/55">{label}</p>
            <p className="mt-0.5 tabular-nums">
              <b className="text-2xl font-black">{n}</b>
              <span className="ml-0.5 text-xs text-ink/50">{unit}</span>
            </p>
          </div>
        ))}
      </section>

      <Link to="/passport/wallet" className="mt-3 flex items-center justify-between rounded-3xl bg-ink p-4 text-white shadow-md">
        <div>
          <p className="text-xs text-white/65">
            {walletVisit ? (walletVisit.visitDate === today ? '今天的 kidZos' : `${formatISODate(walletVisit.visitDate)} 入園餘額`) : 'kidZos 錢包'}
          </p>
          <p className="mt-0.5 text-3xl font-black tabular-nums">
            {walletVisit ? kidzos : '—'}
            <span className="ml-1 text-sm font-bold text-white/70">kidZos</span>
          </p>
          {twdAll > 0 && <p className="mt-0.5 text-xs text-white/60">累計自費 {formatNtd(twdAll)}</p>}
        </div>
        <span className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-bold">錢包 ›</span>
      </Link>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-black">印章牆</h2>
          <div className="flex rounded-full bg-ink/[0.06] p-0.5 text-xs font-bold">
            {(
              [
                ['all', `全部 ${JOBS.length}`],
                ['done', `已蓋 ${stats.size}`],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={wall === v}
                onClick={() => setWall(v)}
                className={`rounded-full px-3 py-1.5 ${wall === v ? 'bg-white shadow-sm' : 'text-ink/55'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {wallJobs.length === 0 ? (
          <p className="rounded-2xl bg-white p-6 text-center text-sm text-ink/50 ring-1 ring-ink/5">還沒有印章，完成第一個職業就能蓋章！</p>
        ) : (
          <ul className="grid grid-cols-3 gap-x-2 gap-y-4 rounded-3xl bg-[#fbf3e4] p-3 ring-1 ring-ink/5">
            {wallJobs.map((j) => {
              const s = stats.get(j.id);
              const e = eligibility(j, years);
              return (
                <li key={j.id}>
                  <Link to={`/job/${j.id}`} className="flex flex-col items-center gap-1">
                    {s ? (
                      <Stamp name={j.nameZh} at={s.lastAt} index={s.count} size={96} tilt={stampTilt(`${j.id}-${s.count}`)} />
                    ) : (
                      <EmptyStamp label={j.nameZh} locked={e === 'locked' || e === 'tooOld'} />
                    )}
                    <span className={`text-[11px] ${s ? 'font-bold' : 'text-ink/40'}`}>
                      {j.mapNo ?? '?'} 號{s && s.count > 1 ? `・×${s.count}` : ''}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-black">入園相簿</h2>
        {albums.length === 0 ? (
          <p className="rounded-2xl bg-white p-6 text-center text-sm text-ink/50 ring-1 ring-ink/5">蓋章時拍的照片會出現在這裡。</p>
        ) : (
          albums.map(([date, list]) => (
            <div key={date} className="mb-5">
              <h3 className="mb-2 text-sm font-bold text-ink/60">
                {formatISODate(date)}・{list.length} 張
              </h3>
              <div className="grid grid-cols-3 gap-1.5">
                {list.map((c) => (
                  <Thumb key={c.id} c={c} onOpen={setViewing} />
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      <PhotoViewer completion={viewing} onClose={() => setViewing(null)} />
    </main>
  );
}
