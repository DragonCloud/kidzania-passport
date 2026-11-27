import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../../db/db';
import { usePassport } from '../../hooks/usePassport';
import { formatISODate, fromLocalInput, localDateISO, toLocalInput } from '../../lib/format';
import { jobById } from '../../lib/jobs';
import { localMidnight } from '../../lib/passport';
import { setPassportIssuedAt } from '../../lib/passportStore';
import { BottomSheet } from '../BottomSheet';
import { IconAlert } from '../icons';

const inputCls = 'w-full rounded-xl bg-white px-3 py-2.5 text-base ring-1 ring-ink/15 outline-none focus:ring-2 focus:ring-brand';

/**
 * 日期＋時間輸入。沒動過時回傳「按儲存的那一刻」（精確到毫秒），
 * 避免分鐘被截斷，讓同一分鐘內稍早蓋的章被誤算到辦理後。
 */
export function useDateTime(initial: number | null) {
  const [start] = useState(() => toLocalInput(initial ?? Date.now()));
  const [value, setValue] = useState(start);
  const resolve = (): number | null => {
    if (value === start) return initial ?? Date.now();
    return fromLocalInput(value);
  };
  return { value, setValue, resolve, touched: value !== start, preview: value === start ? (initial ?? Date.now()) : fromLocalInput(value) };
}

/** 舊護照（v0.3.0 建立，沒有辦理時間）的一鍵修正提示 */
export function PassportFixBanner({ onMessage }: { onMessage?: (m: string) => void }) {
  const s = usePassport();
  const [open, setOpen] = useState(false);
  if (!s.loaded || !s.needsIssuedAt) return null;
  return (
    <>
      <div className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-200" role="status">
        <p className="flex items-start gap-1.5 font-bold">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          辦護照前的章不算
        </p>
        <p className="mt-1 text-amber-900/80">
          這本護照是舊版建立的，只記了辦理日期，所以 {formatISODate(s.passport!.issuedOn)} 辦理前蓋的章也被算進進度和加碼。選一下辦理時間就能修正。
        </p>
        <button type="button" onClick={() => setOpen(true)} className="mt-2 w-full rounded-xl bg-amber-600 py-2.5 font-bold text-white">
          修正：選辦理時間
        </button>
      </div>
      {open && <IssuedAtSheet onClose={() => setOpen(false)} onSaved={(n) => onMessage?.(n)} />}
    </>
  );
}

/** 選辦理時間，並列出那天每個章的時間，方便判斷哪些在辦理前 */
export function IssuedAtSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const s = usePassport();
  const dt = useDateTime(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const at = dt.preview;
  const day = at !== null ? localDateISO(at) : (s.passport?.issuedOn ?? s.today);
  const dayStamps =
    useLiveQuery(
      () =>
        db.completions
          .where('completedAt')
          .between(localMidnight(day), localMidnight(day) + 86_400_000, true, false)
          .sortBy('completedAt'),
      [day],
    ) ?? [];

  // 蓋章當下就有加碼的章，通常是護照建立後才蓋的，列出來幫忙判斷
  const bonused =
    useLiveQuery(async () => {
      const ids = dayStamps.map((c) => c.id);
      if (!ids.length) return new Set<string>();
      const es = await db.ledger.where('completionId').anyOf(ids).filter((e) => !!e.passportBonus).toArray();
      return new Set(es.map((e) => e.completionId!));
    }, [dayStamps.map((c) => c.id).join()]) ?? new Set<string>();

  async function save() {
    const ms = dt.resolve();
    if (ms === null) return setError('請選辦理時間');
    setBusy(true);
    try {
      await setPassportIssuedAt(ms);
      onSaved('已修正：辦護照前的章不算');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
      setBusy(false);
    }
  }

  const before = at === null ? 0 : dayStamps.filter((c) => c.completedAt < at).length;
  return (
    <BottomSheet
      open
      title="辦理時間"
      onClose={onClose}
      footer={
        <button type="button" disabled={busy} onClick={() => void save()} className="w-full rounded-2xl bg-brand py-3 font-bold text-white disabled:opacity-60">
          {before > 0 ? `儲存（${before} 個章改為辦護照前）` : '儲存'}
        </button>
      }
    >
      <p className="mt-2 text-sm text-ink/65">之前沒有記下按建立的時間，請選實際辦好護照的時間（預設現在；如果辦好後還有蓋章，請改成那之前）。這個時間之前蓋的章不算進升級進度，也不套用加碼；已記的帳會自動改回表定值。</p>
      <label className="mt-3 block">
        <span className="text-sm font-bold text-ink/70">辦理時間</span>
        <input type="datetime-local" value={dt.value} max={toLocalInput(Date.now())} onChange={(e) => dt.setValue(e.target.value)} className={`${inputCls} mt-1`} />
      </label>
      <h3 className="mt-4 mb-1.5 text-sm font-bold text-ink/70">{formatISODate(day)} 蓋的章</h3>
      {dayStamps.length === 0 ? (
        <p className="rounded-xl bg-white p-3 text-sm text-ink/50 ring-1 ring-ink/5">這天沒有蓋章。</p>
      ) : (
        <ul className="divide-y divide-ink/5 rounded-xl bg-white ring-1 ring-ink/5">
          {dayStamps.map((c) => {
            const pre = at !== null && c.completedAt < at;
            const d = new Date(c.completedAt);
            return (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-12 font-bold tabular-nums">
                  {String(d.getHours()).padStart(2, '0')}:{String(d.getMinutes()).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {jobById(c.jobId)?.nameZh ?? c.jobId}
                  {bonused.has(c.id) && <span className="ml-1 text-[11px] text-ink/45">當時有加碼</span>}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${pre ? 'bg-stone-200 text-stone-700' : 'bg-emerald-100 text-emerald-800'}`}>
                  {pre ? '辦護照前' : '算護照章'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    </BottomSheet>
  );
}

/** 「辦護照前」小標籤 */
export function BeforePassportTag({ className = '' }: { className?: string }) {
  return <span className={`inline-block rounded-full bg-stone-200 px-1.5 py-px text-[10px] font-bold text-stone-700 ${className}`}>辦護照前</span>;
}
