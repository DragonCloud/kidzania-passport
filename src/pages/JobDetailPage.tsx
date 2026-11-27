import { useEffect, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MapNoBadge } from '../components/Badge';
import { EconomyTag } from '../components/EconomyTag';
import { IconAlert, IconClock, IconExternal, IconPin, IconStamp } from '../components/icons';
import { JobStatusBadges } from '../components/JobBadges';
import { PageHeader } from '../components/PageHeader';
import { useBlobUrl } from '../hooks/useBlobUrl';
import { useChild } from '../hooks/useChild';
import { useJobCompletions } from '../hooks/useCompletions';
import { eligibility } from '../lib/age';
import { formatAgeReq, formatDateTime, formatFloor, formatKidzos, formatNtd } from '../lib/format';
import { jobById } from '../lib/jobs';
import type { Completion, Job } from '../types/models';
import { BeforePassportTag } from '../components/passport/PassportFix';
import { isBeforePassport } from '../lib/passport';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-2.5">
      <dt className="w-20 shrink-0 text-sm text-ink/55">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm font-medium">{children}</dd>
    </div>
  );
}

const dash = <span className="text-ink/35">未公布</span>;

function economyText(job: Job): ReactNode {
  if (job.ntdFee !== null) return `自費 ${formatNtd(job.ntdFee)}（不使用 kidZos）`;
  if (job.kidzoDelta !== null) return job.kidzoDelta >= 0 ? `賺 ${formatKidzos(job.kidzoDelta)}` : `付 ${formatKidzos(-job.kidzoDelta, false)}`;
  return dash;
}

function sourceLabel(s: string): { label: string; href?: string } {
  if (s === 'official-map') return { label: '官方城市地圖（不公開散布）' };
  try {
    const u = new URL(s);
    return { label: u.hostname.replace(/^www\./, '') + (u.hostname.includes('kidzania') ? '（官網）' : ''), href: s };
  } catch {
    return { label: s };
  }
}

function CompletionItem({ c, index }: { c: Completion; index: number }) {
  const thumb = useBlobUrl(c.thumbBlobId);
  const { child } = useChild();
  const before = isBeforePassport(c, child.passport);
  return (
    <li className="flex items-center gap-3 py-2">
      {thumb ? (
        <img src={thumb} alt="" className="h-12 w-12 rounded-xl object-cover" />
      ) : (
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-2xl text-emerald-600">
          <IconStamp />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">
          第 {index} 次
          {before && <BeforePassportTag className="ml-1.5 align-middle" />}
          {c.countsForPassport === false && <span className="ml-1.5 align-middle text-[10px] font-bold text-ink/45">不算護照章</span>}
          {c.countsForPassport === true && <span className="ml-1.5 align-middle text-[10px] font-bold text-emerald-700">手動算護照章</span>}
        </p>
        <p className="text-xs text-ink/55">{formatDateTime(c.completedAt)}</p>
        {c.note && <p className="truncate text-xs text-ink/70">{c.note}</p>}
      </div>
      <Link to={`/completion/${c.id}/edit`} className="text-sm font-bold text-brand">
        編輯
      </Link>
    </li>
  );
}

export default function JobDetailPage() {
  const { id } = useParams();
  const job = id ? jobById(id) : undefined;
  const { displayName, years, child } = useChild();
  const completions = useJobCompletions(job?.id);

  // 推入頁一律從頂端開始（總覽的捲動位置由 HomePage 自己記住）
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  if (!job) {
    return (
      <>
        <PageHeader title="找不到職業" />
        <main className="mx-auto max-w-md px-4 py-10 text-center text-ink/60">
          這個職業不存在。<Link to="/" className="font-bold text-brand underline">回總覽</Link>
        </main>
      </>
    );
  }

  const e = eligibility(job, years);
  const stats = completions.length ? { count: completions.length, lastAt: completions[0]!.completedAt } : undefined;
  const pinKey = job.mapNo !== null ? `no-${job.mapNo}` : null;
  const ctaName = child.name ? `${displayName}完成了` : '完成了';
  const ageBlocked = e === 'locked' || e === 'tooOld';
  const again = stats ? `（第 ${stats.count + 1} 次）` : '';

  return (
    <>
      <PageHeader title={job.nameZh} />
      <main className="mx-auto max-w-md px-4 pt-2 pb-[calc(6rem+env(safe-area-inset-bottom))]">
        <section className={`rounded-3xl p-5 text-white shadow-md ${job.floor === 2 ? 'bg-teal-700' : 'bg-brand'}`}>
          <div className="flex items-start gap-4">
            <MapNoBadge mapNo={job.mapNo} floor={job.floor} size="lg" inverse />
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl leading-tight font-black">{job.nameZh}</h2>
              <p className="mt-1 text-sm text-white/85">
                {formatFloor(job.floor)}・{job.venueZh}
              </p>
              {job.sponsor && <p className="mt-0.5 text-sm text-white/85">{job.sponsor}</p>}
            </div>
          </div>
        </section>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <EconomyTag job={job} />
          <JobStatusBadges job={job} eligibility={e} stats={stats} />
        </div>

        {ageBlocked && (
          <p className="mt-3 flex items-start gap-2 rounded-2xl bg-stone-100 p-3 text-sm text-stone-700">
            <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
            官方年齡為 {formatAgeReq(job)}，{displayName}目前還未達到。若現場仍可參加，一樣可以蓋章。
          </p>
        )}

        {job.note && (
          <section className="mt-3 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200" aria-label="備註">
            <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-amber-900">
              <IconAlert className="h-4 w-4" />備註
            </h3>
            <p className="text-sm leading-relaxed text-amber-950/85">{job.note}</p>
          </section>
        )}

        <dl className="mt-4 divide-y divide-ink/5 rounded-2xl bg-white px-4 shadow-sm ring-1 ring-ink/5">
          <Row label="場館">{job.venueZh}</Row>
          <Row label="地圖編號">{job.mapNo !== null ? `${job.mapNo} 號・${formatFloor(job.floor)}` : dash}</Row>
          <Row label="合作品牌">{job.sponsor ?? dash}</Row>
          <Row label="分類">{job.mapCategory}</Row>
          <Row label="年齡">{job.minAge === null && job.maxAge === null ? <span className="text-amber-800">年齡未知・待確認</span> : formatAgeReq(job)}</Row>
          {job.heightReq && <Row label="身高">{job.heightReq} 以上</Row>}
          <Row label="時長">
            {job.durationMin !== null ? (
              <span className="inline-flex items-center gap-1">
                <IconClock className="h-4 w-4 text-ink/50" />約 {job.durationMin} 分鐘
              </span>
            ) : (
              dash
            )}
          </Row>
          <Row label="收支">{economyText(job)}</Row>
          {job.accompanyRule && <Row label="陪同">{job.accompanyRule}</Row>}
        </dl>
        <p className="mt-1.5 px-1 text-[11px] text-ink/45">實際時長與場次以館外螢幕為準。</p>

        {job.summary && (
          <section className="mt-5">
            <h3 className="mb-1.5 text-sm font-bold text-ink/60">簡介</h3>
            <p className="leading-relaxed">{job.summary}</p>
          </section>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          {job.officialUrl ? (
            <a href={job.officialUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 rounded-2xl bg-white py-3 text-sm font-bold shadow-sm ring-1 ring-ink/10">
              官網頁面 <IconExternal className="h-4 w-4" />
            </a>
          ) : (
            <span className="flex items-center justify-center rounded-2xl bg-ink/[0.04] px-2 py-3 text-center text-xs text-ink/50">官網目前沒有此職業頁</span>
          )}
          {pinKey && job.floor !== null ? (
            <Link to={`/map?floor=${job.floor}&pin=${pinKey}`} className="flex items-center justify-center gap-1.5 rounded-2xl bg-white py-3 text-sm font-bold shadow-sm ring-1 ring-ink/10">
              <IconPin className="h-4 w-4" />在地圖上看
            </Link>
          ) : (
            <span className="flex items-center justify-center rounded-2xl bg-ink/[0.04] py-3 text-xs text-ink/50">地圖位置未知</span>
          )}
        </div>

        <section className="mt-6">
          <h3 className="mb-1 text-sm font-bold text-ink/60">蓋章紀錄</h3>
          {completions.length === 0 ? (
            <p className="rounded-2xl bg-white p-4 text-sm text-ink/50 ring-1 ring-ink/5">還沒有紀錄</p>
          ) : (
            <ul className="divide-y divide-ink/5 rounded-2xl bg-white px-4 ring-1 ring-ink/5">
              {completions.map((c, i) => (
                <CompletionItem key={c.id} c={c} index={completions.length - i} />
              ))}
            </ul>
          )}
        </section>

        {job.sourceUrls.length > 0 && (
          <details className="mt-6 text-xs text-ink/55">
            <summary className="cursor-pointer font-bold">資料來源</summary>
            <ul className="mt-2 space-y-1 pl-4">
              {job.sourceUrls.map((s) => {
                const { label, href } = sourceLabel(s);
                return (
                  <li key={s} className="list-disc">
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
                        {label}
                      </a>
                    ) : (
                      label
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </main>

      {/* 實心底欄（不用漸層蓋住內容）；main 的 pb 與此高度一致，捲到底時內容不被遮住 */}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-ink/10 bg-paper/95 px-4 pt-3 pb-3 backdrop-blur">
        {ageBlocked ? (
          <Link
            to={`/job/${job.id}/stamp`}
            className="mx-auto flex max-w-md items-center justify-center gap-2 rounded-2xl bg-white py-3.5 text-base font-bold text-ink/75 ring-1 ring-ink/20 active:scale-[0.99]"
          >
            <IconStamp className="h-5 w-5" />
            年齡未到，仍要蓋章{again}
          </Link>
        ) : (
          <Link
            to={`/job/${job.id}/stamp`}
            className="mx-auto flex max-w-md items-center justify-center gap-2 rounded-2xl bg-brand py-4 text-lg font-black text-white shadow-lg shadow-brand/30 active:scale-[0.99]"
          >
            <IconStamp className="h-6 w-6" />
            {ctaName}，去蓋章{again}
          </Link>
        )}
      </div>
    </>
  );
}
