import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../../db/db';
import { summarizeCosts, TWD_CATEGORY_LABEL } from '../../lib/costs';
import { formatNtd } from '../../lib/format';
import type { TwdCategory, Visit } from '../../types/models';

const ORDER: TwdCategory[] = ['passport', 'ticket', 'job', 'other'];
const BAR: Record<TwdCategory, string> = {
  passport: 'bg-violet-500',
  ticket: 'bg-sky-500',
  job: 'bg-amber-500',
  other: 'bg-ink/40',
};

/** 費用總覽：本次入園／累計；新臺幣分類＋省下多少（kidZos 不換算新臺幣） */
export function CostOverview({ visit, onRecordTickets }: { visit?: Visit; onRecordTickets?: () => void }) {
  const [scope, setScope] = useState<'visit' | 'all'>(visit ? 'visit' : 'all');
  const effective = visit ? scope : 'all';
  const data = useLiveQuery(async () => ({ visits: await db.visits.toArray(), ledger: await db.ledger.toArray() }), []);
  if (!data) return null;
  const s = summarizeCosts(data.visits, data.ledger, effective === 'visit' && visit ? { visitId: visit.id } : 'all');
  const cats = ORDER.filter((c) => !(effective === 'visit' && c === 'passport' && s.twd.passport === 0));
  const max = Math.max(1, ...cats.map((c) => s.twd[c]));

  return (
    <section className="mt-5 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-ink/5" aria-labelledby="cost-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="cost-title" className="font-bold">
          費用總覽
        </h2>
        {visit && (
          <div className="flex rounded-full bg-ink/[0.06] p-0.5 text-xs font-bold" role="tablist">
            {(['visit', 'all'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={scope === k}
                onClick={() => setScope(k)}
                className={`rounded-full px-3 py-1.5 ${scope === k ? 'bg-white shadow-sm' : 'text-ink/55'}`}
              >
                {k === 'visit' ? '這次' : '累計'}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="mt-2 text-3xl font-black tabular-nums">
        {formatNtd(s.twd.total)}
        <span className="ml-1.5 text-sm font-bold text-ink/50">新臺幣{effective === 'all' ? `・${s.visits} 次入園` : ''}</span>
      </p>

      <ul className="mt-3 space-y-2">
        {cats.map((c) => (
          <li key={c}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-ink/70">{TWD_CATEGORY_LABEL[c]}</span>
              <span className="font-bold tabular-nums">
                {c === 'ticket' && effective === 'visit' && s.ticketsUnrecorded > 0 && s.twd.ticket === 0 ? (
                  <span className="font-normal text-ink/45">未記錄門票</span>
                ) : (
                  formatNtd(s.twd[c])
                )}
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-ink/[0.06]">
              <div className={`h-full rounded-full ${BAR[c]}`} style={{ width: `${(s.twd[c] / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>

      {s.ticketsUnrecorded > 0 && (
        <p className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-ink/[0.04] p-2.5 text-xs text-ink/60">
          <span>
            {effective === 'visit' ? '這次入園還沒記錄門票，' : `有 ${s.ticketsUnrecorded} 次入園未記錄門票，`}
            門票金額沒有算進來（不是 0）。
          </span>
          {effective === 'visit' && onRecordTickets && (
            <button type="button" onClick={onRecordTickets} className="shrink-0 rounded-full bg-white px-3 py-1.5 font-bold text-brand ring-1 ring-brand/30">
              記錄門票
            </button>
          )}
        </p>
      )}

      <h3 className="mt-4 text-sm font-bold text-ink/60">省下多少</h3>
      <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
        <dt className="text-ink/70">門票優惠（原價−實付）</dt>
        <dd className="text-right font-bold tabular-nums">{formatNtd(s.saved.ticketTwd)}</dd>
        <dt className="text-ink/70">護照薪資加碼</dt>
        <dd className="text-right font-bold text-earn tabular-nums">+{s.saved.kidzosWage} kidZos</dd>
        <dt className="text-ink/70">護照減免（體驗、購物）</dt>
        <dd className="text-right font-bold text-earn tabular-nums">{s.saved.kidzosDiscount} kidZos</dd>
      </dl>
      <p className="mt-2 text-[11px] text-ink/45">kidZos 是園內貨幣，不換算成新臺幣。{effective === 'visit' ? '護照辦理費不屬於任何一次入園，只算在累計。' : ''}</p>
    </section>
  );
}
