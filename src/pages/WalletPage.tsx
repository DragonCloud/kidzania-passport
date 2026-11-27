import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { STARTING_KIDZOS } from '../config/defaults';
import { db } from '../db/db';
import { BottomSheet } from '../components/BottomSheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LedgerEntryForm } from '../components/LedgerEntryForm';
import { LedgerList } from '../components/LedgerList';
import { PageHeader } from '../components/PageHeader';
import { useToday } from '../hooks/useToday';
import { useVisits } from '../hooks/useVisits';
import { formatISODate, formatNtd } from '../lib/format';
import { sumKidzos, sumTwdSpent } from '../lib/ledger';
import { createVisit, deleteVisit, previousVisitBalance, updateVisit } from '../lib/visits';
import type { LedgerEntry, Visit } from '../types/models';

const NO_VISIT = 'none';
const inputCls =
  'w-full rounded-xl bg-white px-3 py-2.5 text-base ring-1 ring-ink/15 outline-none focus:ring-2 focus:ring-brand';

/**
 * kidZos 錢包：依入園分頁。這是家庭記帳，不是園內即時餘額。
 * /passport/wallet?visit=<id>
 */
export default function WalletPage() {
  const [params, setParams] = useSearchParams();
  const today = useToday();
  const visits = useVisits();
  const orphanCount = useLiveQuery(() => db.ledger.filter((e) => !e.visitId).count(), []) ?? 0;

  const requested = params.get('visit');
  const selected: string | null =
    requested && (requested === NO_VISIT || visits.some((v) => v.id === requested)) ? requested : (visits[0]?.id ?? (orphanCount ? NO_VISIT : null));
  const visit = visits.find((v) => v.id === selected);
  const select = (id: string) => setParams({ visit: id }, { replace: true });

  const entries =
    useLiveQuery(async () => {
      if (!selected) return [];
      const list = selected === NO_VISIT ? await db.ledger.filter((e) => !e.visitId).toArray() : await db.ledger.where('visitId').equals(selected).toArray();
      return list.sort((a, b) => b.at - a.at);
    }, [selected]) ?? ([] as LedgerEntry[]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LedgerEntry | null>(null);
  const [visitSheet, setVisitSheet] = useState(false);

  const hasToday = visits.some((v) => v.visitDate === today);
  const kidzos = sumKidzos(entries);
  const twd = sumTwdSpent(entries);

  return (
    <>
      <PageHeader title="kidZos 錢包" />
      <main className="mx-auto max-w-md px-4 pt-1 pb-32">
        {!hasToday && <StartVisitCard today={today} onCreated={select} />}

        {(visits.length > 0 || orphanCount > 0) && (
          <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="入園紀錄">
            {visits.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={selected === v.id}
                onClick={() => select(v.id)}
                className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-bold ring-1 ${selected === v.id ? 'bg-ink text-white ring-ink' : 'bg-white ring-ink/10'}`}
              >
                {v.visitDate === today ? '今天' : formatISODate(v.visitDate).replace(/^\d{4}\//, '')}
              </button>
            ))}
            {orphanCount > 0 && (
              <button
                type="button"
                role="tab"
                aria-selected={selected === NO_VISIT}
                onClick={() => select(NO_VISIT)}
                className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-bold ring-1 ${selected === NO_VISIT ? 'bg-ink text-white ring-ink' : 'bg-white ring-ink/10'}`}
              >
                未歸入入園
              </button>
            )}
          </div>
        )}

        {selected && (
          <>
            <section className="mt-3 rounded-3xl bg-ink p-5 text-white shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-white/65">{visit ? `${formatISODate(visit.visitDate)} 入園` : '未歸入入園的帳'}</p>
                  <p className="mt-1 text-4xl font-black tabular-nums">
                    {kidzos}
                    <span className="ml-1.5 text-base font-bold text-white/70">kidZos</span>
                  </p>
                </div>
                {visit && (
                  <button type="button" onClick={() => setVisitSheet(true)} className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold">
                    編輯入園
                  </button>
                )}
              </div>
              <div className="mt-4 flex gap-4 text-xs text-white/70">
                {visit && <span>起始 {visit.startingKidzos}</span>}
                {twd > 0 && <span>自費新臺幣 {formatNtd(twd)}</span>}
              </div>
            </section>
            <p className="mt-2 px-1 text-[11px] text-ink/45">家庭記帳，和園內實際餘額不一定相同；對不上時用「手動調整」修正。</p>

            <h2 className="mt-5 mb-2 text-sm font-bold text-ink/60">流水</h2>
            <LedgerList
              entries={entries}
              onSelect={(e) => {
                if (e.type === 'grant') setVisitSheet(true);
                else {
                  setEditing(e);
                  setFormOpen(true);
                }
              }}
            />
          </>
        )}

        {!selected && (
          <p className="mt-6 text-center text-sm text-ink/50">建立入園紀錄後，蓋章時會自動記帳。</p>
        )}
      </main>

      {selected && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-paper via-paper to-paper/0 px-4 pt-6 pb-3">
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="mx-auto block w-full max-w-md rounded-2xl bg-brand py-4 text-lg font-black text-white shadow-lg shadow-brand/30"
          >
            ＋ 記一筆
          </button>
        </div>
      )}

      <LedgerEntryForm open={formOpen} entry={editing} visitId={visit?.id} onClose={() => setFormOpen(false)} />
      {visit && <VisitSheet open={visitSheet} visit={visit} onClose={() => setVisitSheet(false)} />}
    </>
  );
}

function StartVisitCard({ today, onCreated }: { today: string; onCreated: (id: string) => void }) {
  const [amount, setAmount] = useState(String(STARTING_KIDZOS));
  const [prev, setPrev] = useState<{ date: string; balance: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void previousVisitBalance().then((p) => p && p.balance > 0 && setPrev({ date: p.visit.visitDate, balance: p.balance }));
  }, []);

  async function start() {
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 0) return;
    setBusy(true);
    const v = await createVisit({ visitDate: today, startingKidzos: n });
    setBusy(false);
    onCreated(v.id);
  }

  return (
    <section className="mt-2 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-brand/20">
      <h2 className="font-bold">今天要入園嗎？</h2>
      <p className="mt-1 text-sm text-ink/60">入園時每位孩子會拿到 {STARTING_KIDZOS} kidZos 起始資金。</p>
      <label className="mt-3 flex items-center gap-2">
        <span className="shrink-0 text-sm font-bold text-ink/70">起始資金</span>
        <input type="number" inputMode="numeric" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputCls} tabular-nums`} />
      </label>
      {prev && (
        <button type="button" onClick={() => setAmount(String(prev.balance))} className="mt-2 text-sm font-bold text-brand underline">
          改用上次（{formatISODate(prev.date)}）留下的 {prev.balance} kidZos
        </button>
      )}
      <button type="button" disabled={busy} onClick={() => void start()} className="mt-3 w-full rounded-2xl bg-brand py-3 font-bold text-white disabled:opacity-60">
        建立今天入園
      </button>
    </section>
  );
}

function VisitSheet({ open, visit, onClose }: { open: boolean; visit: Visit; onClose: () => void }) {
  return open ? <VisitSheetInner key={visit.id} visit={visit} onClose={onClose} /> : null;
}

function VisitSheetInner({ visit, onClose }: { visit: Visit; onClose: () => void }) {
  const [date, setDate] = useState(visit.visitDate);
  const [start, setStart] = useState(String(visit.startingKidzos));
  const [notes, setNotes] = useState(visit.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [keep, setKeep] = useState(true);

  async function save() {
    const n = Number(start);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(n) || n < 0) {
      setError('請確認日期與起始資金');
      return;
    }
    await updateVisit(visit.id, { visitDate: date, startingKidzos: n, notes: notes.trim() || undefined });
    onClose();
  }

  return (
    <>
      <BottomSheet
        open
        title="編輯入園紀錄"
        onClose={onClose}
        footer={
          <div className="flex gap-3">
            <button type="button" onClick={() => setConfirm(true)} className="rounded-2xl px-4 py-3 font-bold text-red-700 ring-1 ring-red-200">
              刪除
            </button>
            <button type="button" onClick={() => void save()} className="flex-1 rounded-2xl bg-brand py-3 font-bold text-white">
              儲存
            </button>
          </div>
        }
      >
        <label className="mt-3 block">
          <span className="text-sm font-bold text-ink/70">入園日期</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} mt-1`} />
        </label>
        <label className="mt-4 block">
          <span className="text-sm font-bold text-ink/70">起始資金（kidZos）</span>
          <input type="number" inputMode="numeric" min={0} value={start} onChange={(e) => setStart(e.target.value)} className={`${inputCls} mt-1 tabular-nums`} />
          <span className="mt-1 block text-xs text-ink/50">預設 {STARTING_KIDZOS}；若帶著上次留下的 kidZos 入園，可改成那個數字。</span>
        </label>
        <label className="mt-4 block">
          <span className="text-sm font-bold text-ink/70">備註</span>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={60} className={`${inputCls} mt-1`} />
        </label>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </BottomSheet>
      <ConfirmDialog
        open={confirm}
        title={`刪除 ${formatISODate(visit.visitDate)} 入園？`}
        confirmLabel="刪除"
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={() => void deleteVisit(visit.id, { keepRecords: keep }).then(onClose)}
      >
        <p>起始資金那筆帳會刪除。</p>
        <label className="mt-3 flex items-center gap-2">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="h-5 w-5 accent-brand" />
          保留這天的蓋章紀錄與其他帳目
        </label>
        {!keep && <p className="mt-2 text-red-700">這天的印章、照片與帳目都會刪除，無法復原。</p>}
      </ConfirmDialog>
    </>
  );
}

