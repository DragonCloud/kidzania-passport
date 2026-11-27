import { LEDGER_TYPE_LABEL } from '../lib/ledger';
import { formatDateTime, formatKidzos, formatNtd } from '../lib/format';
import { jobById } from '../lib/jobs';
import type { LedgerEntry, LedgerType } from '../types/models';

const ICON: Record<LedgerType, string> = {
  grant: '🎟️',
  earn: '💼',
  spend: '🎯',
  purchase: '🎁',
  donate: '💝',
  atm: '🏧',
  adjust: '✏️',
  twd_fee: '💵',
};

export function ledgerTitle(e: LedgerEntry): string {
  const job = e.jobId ? jobById(e.jobId) : undefined;
  if (job) return `${job.nameZh}`;
  return LEDGER_TYPE_LABEL[e.type];
}

export function LedgerList({ entries, onSelect, empty = '還沒有帳目' }: { entries: LedgerEntry[]; onSelect?: (e: LedgerEntry) => void; empty?: string }) {
  if (!entries.length) return <p className="rounded-2xl bg-white p-4 text-sm text-ink/50 ring-1 ring-ink/5">{empty}</p>;
  return (
    <ul className="divide-y divide-ink/5 rounded-2xl bg-white ring-1 ring-ink/5">
      {entries.map((e) => {
        const twd = e.currency === 'TWD';
        const sub = [e.jobId ? LEDGER_TYPE_LABEL[e.type] : null, e.note && e.note !== ledgerTitle(e) ? e.note : null]
          .filter(Boolean)
          .join('・');
        return (
          <li key={e.id}>
            <button type="button" onClick={() => onSelect?.(e)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-ink/[0.03]">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink/[0.05] text-lg" aria-hidden="true">
                {ICON[e.type]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{ledgerTitle(e)}</span>
                <span className="block truncate text-xs text-ink/50">
                  {formatDateTime(e.at)}
                  {sub ? `・${sub}` : ''}
                </span>
              </span>
              <span
                className={`shrink-0 text-right text-sm font-black tabular-nums ${twd ? 'text-twd' : e.amount >= 0 ? 'text-earn' : 'text-spend'}`}
              >
                {twd ? `${e.amount < 0 ? '−' : '+'}${formatNtd(Math.abs(e.amount))}` : formatKidzos(e.amount)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
