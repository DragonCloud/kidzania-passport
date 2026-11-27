import { useState } from 'react';
import { useChild } from '../../hooks/useChild';
import { formatISODate, formatNtd } from '../../lib/format';
import { saveVisitTickets } from '../../lib/passportStore';
import { normalizeTickets, TICKET_SOURCE, TICKET_TYPES, ticketPricesOf, ticketTotals } from '../../lib/tickets';
import type { TicketTypeId, Visit, VisitTicket } from '../../types/models';
import { BottomSheet } from '../BottomSheet';

interface Line {
  key: string;
  type: TicketTypeId | 'custom';
  label: string;
  qty: string;
  listPrice: string;
  paidPrice: string;
  note: string;
}

let seq = 0;
const k = () => `l${++seq}`;

/** 記錄這次入園買了哪些門票（票種×數量、原價與實付；可加自訂／其他優惠） */
export function TicketSheet({ visit, onClose }: { visit: Visit; onClose: () => void }) {
  const { child } = useChild();
  const prices = ticketPricesOf(child).prices;

  const [lines, setLines] = useState<Line[]>(() => {
    const existing = visit.tickets;
    if (existing && existing.length) {
      return existing.map((t) => ({
        key: k(),
        type: t.type,
        label: t.label,
        qty: String(t.qty),
        listPrice: String(t.listPrice),
        paidPrice: String(t.paidPrice),
        note: t.note ?? '',
      }));
    }
    // 第一次：預設 1 張孩童票＋1 張成人陪同
    return [line('child', prices.child, 1), line('adult', prices.adult, 1)];
  });
  const [error, setError] = useState<string | null>(null);

  function line(type: TicketTypeId, price: number, qty = 1): Line {
    const label = TICKET_TYPES.find((t) => t.id === type)!.label;
    return { key: k(), type, label, qty: String(qty), listPrice: String(price), paidPrice: String(price), note: '' };
  }
  const set = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const parsed: VisitTicket[] = lines.map((l) => ({
    type: l.type,
    label: l.label,
    qty: Number(l.qty),
    listPrice: Number(l.listPrice),
    paidPrice: Number(l.paidPrice),
    note: l.note,
  }));
  const totals = ticketTotals(normalizeTickets(parsed))!;
  const used = new Set(lines.map((l) => l.type));

  async function save() {
    for (const l of lines) {
      for (const [v, what] of [
        [l.qty, '數量'],
        [l.listPrice, '原價'],
        [l.paidPrice, '實付'],
      ] as const) {
        const n = Number(v);
        if (v.trim() === '' || !Number.isInteger(n) || n < 0) return setError(`「${l.label || '自訂票'}」的${what}需為 0 以上的整數`);
      }
    }
    await saveVisitTickets(visit.id, parsed);
    onClose();
  }

  return (
    <BottomSheet
      open
      title={`${formatISODate(visit.visitDate)} 門票`}
      onClose={onClose}
      footer={
        <div>
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="text-ink/60">共 {totals.count} 張</span>
            <span>
              實付 <b className="text-lg tabular-nums">{formatNtd(totals.paid)}</b>
              {totals.saved !== 0 && <span className="ml-2 text-xs text-earn">省 {formatNtd(totals.saved)}</span>}
            </span>
          </div>
          <div className="flex gap-3">
            {visit.tickets && (
              <button
                type="button"
                onClick={() => void saveVisitTickets(visit.id, null).then(onClose)}
                className="rounded-2xl px-4 py-3 text-sm font-bold text-ink/60 ring-1 ring-ink/15"
              >
                改回未記錄
              </button>
            )}
            <button type="button" onClick={() => void save()} className="flex-1 rounded-2xl bg-brand py-3 font-bold text-white">
              儲存門票
            </button>
          </div>
        </div>
      }
    >
      <ul className="mt-2 space-y-3">
        {lines.map((l) => (
          <li key={l.key} className="rounded-2xl bg-white p-3 ring-1 ring-ink/10">
            <div className="flex items-center gap-2">
              {l.type === 'custom' ? (
                <input
                  value={l.label}
                  onChange={(e) => set(l.key, { label: e.target.value })}
                  placeholder="名稱，例如：團體票、信用卡優惠"
                  maxLength={20}
                  aria-label="自訂票名稱"
                  className="min-w-0 flex-1 rounded-lg bg-paper px-2 py-1.5 text-sm font-bold ring-1 ring-ink/15 outline-none focus:ring-2 focus:ring-brand"
                />
              ) : (
                <span className="min-w-0 flex-1 font-bold">
                  {l.label}
                  <span className="ml-1 text-xs font-normal text-ink/45">{TICKET_TYPES.find((t) => t.id === l.type)?.hint}</span>
                </span>
              )}
              <Stepper value={l.qty} onChange={(qty) => set(l.key, { qty })} label={`${l.label || '自訂票'}數量`} />
              <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="px-1 text-lg text-ink/35" aria-label={`移除${l.label || '自訂票'}`}>
                ×
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Money label="原價／張" value={l.listPrice} onChange={(listPrice) => set(l.key, { listPrice, ...(l.paidPrice === l.listPrice ? { paidPrice: listPrice } : {}) })} />
              <Money label="實付／張" value={l.paidPrice} onChange={(paidPrice) => set(l.key, { paidPrice })} />
            </div>
            {l.type === 'custom' && (
              <input
                value={l.note}
                onChange={(e) => set(l.key, { note: e.target.value })}
                placeholder="備註（選填）：通路、優惠內容"
                maxLength={40}
                className="mt-2 w-full rounded-lg bg-paper px-2 py-1.5 text-sm ring-1 ring-ink/15 outline-none focus:ring-2 focus:ring-brand"
              />
            )}
          </li>
        ))}
      </ul>

      <h3 className="mt-4 mb-2 text-sm font-bold text-ink/60">加票種</h3>
      <div className="flex flex-wrap gap-2">
        {TICKET_TYPES.filter((t) => !used.has(t.id)).map((t) => (
          <button key={t.id} type="button" onClick={() => setLines((ls) => [...ls, line(t.id, prices[t.id])])} className="rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-ink/15">
            ＋ {t.label} <span className="text-ink/45 tabular-nums">{prices[t.id]}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setLines((ls) => [...ls, { key: k(), type: 'custom', label: '', qty: '1', listPrice: String(prices.child), paidPrice: String(prices.child), note: '' }])}
          className="rounded-full bg-white px-3 py-1.5 text-sm font-bold text-brand ring-1 ring-brand/30"
        >
          ＋ 自訂／其他優惠
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      <p className="mt-3 text-[11px] text-ink/45">
        原價預設取自設定頁「門票價格」（{TICKET_SOURCE.label}，{TICKET_SOURCE.readOn}）。官方沒有會員價；通路折扣或團體票請改實付或用自訂。
      </p>
    </BottomSheet>
  );
}

function Stepper({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const n = Number(value) || 0;
  return (
    <div className="flex items-center rounded-full ring-1 ring-ink/15" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(String(Math.max(0, n - 1)))} className="h-9 w-9 text-lg font-bold" aria-label="減少">
        −
      </button>
      <span className="w-6 text-center font-black tabular-nums" aria-live="polite">
        {n}
      </span>
      <button type="button" onClick={() => onChange(String(n + 1))} className="h-9 w-9 text-lg font-bold" aria-label="增加">
        ＋
      </button>
    </div>
  );
}

function Money({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-ink/55">{label}</span>
      <span className="mt-0.5 flex items-center gap-1 rounded-lg bg-paper px-2 ring-1 ring-ink/15 focus-within:ring-2 focus-within:ring-brand">
        <span className="text-xs text-ink/45">NT$</span>
        <input type="number" inputMode="numeric" min={0} value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-transparent py-1.5 text-base font-bold tabular-nums outline-none" />
      </span>
    </label>
  );
}
