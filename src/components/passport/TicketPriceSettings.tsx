import { useState } from 'react';
import { useChild } from '../../hooks/useChild';
import { useToday } from '../../hooks/useToday';
import { formatISODate } from '../../lib/format';
import { resetTicketPrices, saveTicketPrices } from '../../lib/passportStore';
import { isDefaultPrices, TICKET_SOURCE, TICKET_TYPES, ticketPricesOf } from '../../lib/tickets';
import type { TicketTypeId } from '../../types/models';

/** 設定頁「門票價格」：記錄門票時的預設原價 */
export function TicketPriceSettings({ onMessage }: { onMessage: (m: string) => void }) {
  const { loaded, child } = useChild();
  if (!loaded) return null;
  const table = ticketPricesOf(child);
  return <Inner key={JSON.stringify(table)} prices={table.prices} updatedOn={table.updatedOn} onMessage={onMessage} />;
}

function Inner({ prices, updatedOn, onMessage }: { prices: Record<TicketTypeId, number>; updatedOn?: string; onMessage: (m: string) => void }) {
  const today = useToday();
  const [draft, setDraft] = useState<Record<TicketTypeId, string>>(
    Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, String(v)])) as Record<TicketTypeId, string>,
  );
  const dirty = TICKET_TYPES.some((t) => draft[t.id] !== String(prices[t.id]));
  const isDefault = isDefaultPrices({ prices });
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const next: Partial<Record<TicketTypeId, number>> = {};
    for (const t of TICKET_TYPES) {
      const n = Number(draft[t.id]);
      if (!Number.isInteger(n) || n < 0) return setError(`${t.label}的票價需為 0 以上的整數`);
      next[t.id] = n;
    }
    setError(null);
    await saveTicketPrices(next, today);
    onMessage('已儲存門票價格');
  }

  return (
    <div>
      <p className="text-sm text-ink/65">記錄每次入園的門票時，會先帶入這裡的原價；實付可以另外改。官方沒有會員價。</p>
      <ul className="mt-3 divide-y divide-ink/5">
        {TICKET_TYPES.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">{t.label}</span>
              {t.hint && <span className="block text-xs text-ink/50">{t.hint}</span>}
            </span>
            <span className="text-sm text-ink/50">NT$</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              aria-label={`${t.label}票價`}
              value={draft[t.id]}
              onChange={(e) => setDraft({ ...draft, [t.id]: e.target.value })}
              className="w-24 rounded-xl bg-paper px-3 py-2 text-right text-base font-bold tabular-nums ring-1 ring-ink/15 outline-none focus:ring-2 focus:ring-brand"
            />
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={isDefault && !dirty}
          onClick={() => void resetTicketPrices().then(() => onMessage('已恢復官方預設價格'))}
          className="rounded-2xl px-4 py-2.5 text-sm font-bold ring-1 ring-ink/15 disabled:opacity-40"
        >
          恢復預設
        </button>
        <button type="button" disabled={!dirty} onClick={() => void save()} className="flex-1 rounded-2xl bg-brand py-2.5 text-sm font-bold text-white disabled:opacity-40">
          儲存價格
        </button>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-ink/45">
        資料來源與日期：{TICKET_SOURCE.label}，{TICKET_SOURCE.readOn}。
        {!isDefault && updatedOn && <>你在 {formatISODate(updatedOn)} 改過價格。</>}
        平日、假日、場次如有不同價格，以訂票系統為準。
      </p>
    </div>
  );
}
