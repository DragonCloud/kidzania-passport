import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { STARTING_KIDZOS } from '../config/defaults';
import { db } from '../db/db';
import { requestPersistence } from '../db/persist';
import { MapNoBadge } from '../components/Badge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { IconAlert, IconStamp } from '../components/icons';
import { PageHeader } from '../components/PageHeader';
import { PhotoPicker } from '../components/PhotoPicker';
import { stampTilt } from '../components/Stamp';
import { StampAnimation } from '../components/StampAnimation';
import { useBlobUrl } from '../hooks/useBlobUrl';
import { useChild } from '../hooks/useChild';
import { useSetting } from '../hooks/useSetting';
import { useVisits } from '../hooks/useVisits';
import { addCompletion, deleteCompletion, updateCompletion, type PhotoPair } from '../lib/completions';
import { eligibility } from '../lib/age';
import { formatAgeReq, formatFloor, formatISODate, formatKidzos, formatNtd, fromLocalInput, localDateISO, toLocalInput } from '../lib/format';
import { jobById } from '../lib/jobs';
import { sumKidzos } from '../lib/ledger';
import { createVisit } from '../lib/visits';
import type { Completion, Job, LedgerEntry } from '../types/models';

/** 入園歸屬：既有 visit id、'new'＝建立該日入園、'none'＝不歸入 */
type VisitChoice = string;

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-1.5 text-sm font-bold text-ink/70">{label}</h3>
      {children}
      {hint && <p className="mt-1.5 text-xs text-ink/50">{hint}</p>}
    </section>
  );
}

const inputCls =
  'w-full rounded-xl bg-white px-3 py-2.5 text-base ring-1 ring-ink/15 outline-none focus:ring-2 focus:ring-brand';

interface Done {
  index: number;
  at: number;
  tilt: number;
  ledgerLine: string | null;
}

/** 新增（/job/:id/stamp）與編輯（/completion/:id/edit）共用 */
export default function StampPage({ mode }: { mode: 'new' | 'edit' }) {
  const params = useParams();
  const editing = useLiveQuery(
    async () => (mode === 'edit' && params.id ? ((await db.completions.get(params.id)) ?? null) : null),
    [mode, params.id],
  );
  const job = mode === 'new' ? jobById(params.id ?? '') : editing ? jobById(editing.jobId) : undefined;

  if (mode === 'edit' && editing === undefined) return <PageHeader title="載入中…" />;
  if (!job || (mode === 'edit' && !editing)) {
    return (
      <>
        <PageHeader title="找不到紀錄" />
        <main className="mx-auto max-w-md px-4 py-10 text-center text-ink/60">
          這筆資料不存在。<Link to="/" className="font-bold text-brand underline">回總覽</Link>
        </main>
      </>
    );
  }
  return <StampForm key={editing?.id ?? job.id} job={job} editing={editing ?? null} />;
}

function StampForm({ job, editing }: { job: Job; editing: Completion | null }) {
  const navigate = useNavigate();
  const { child, displayName, years } = useChild();
  const eligibilityNow = eligibility(job, years);
  const ageBlocked = eligibilityNow === 'locked' || eligibilityNow === 'tooOld';
  const visits = useVisits();
  const soundOn = useSetting('soundOn');
  const existingPhoto = useBlobUrl(editing?.photoBlobId);
  const priorCount = useLiveQuery(() => db.completions.where('jobId').equals(job.id).count(), [job.id]) ?? 0;
  const linked =
    useLiveQuery(async () => (editing ? db.ledger.where('completionId').equals(editing.id).toArray() : []), [editing?.id]) ??
    ([] as LedgerEntry[]);

  const [whenInput, setWhenInput] = useState(() => toLocalInput(editing?.completedAt ?? Date.now()));
  const at = fromLocalInput(whenInput);
  const date = at !== null ? localDateISO(at) : null;

  const [visitTouched, setVisitTouched] = useState(false);
  const [visitChoice, setVisitChoice] = useState<VisitChoice>(editing ? (editing.visitId ?? 'none') : 'new');
  // 新增時：依完成日期自動對應當天的入園紀錄（使用者手動選過就不再改）
  const autoChoice = useMemo(() => {
    const sameDay = visits.find((v) => v.visitDate === date);
    return sameDay ? sameDay.id : 'new';
  }, [visits, date]);
  useEffect(() => {
    if (!editing && !visitTouched) setVisitChoice(autoChoice);
  }, [autoChoice, editing, visitTouched]);

  const [photo, setPhoto] = useState<PhotoPair | null | undefined>(undefined);
  const [note, setNote] = useState(editing?.note ?? '');
  const [chargeChoice, setChargeChoice] = useState<'auto' | 'charge' | 'skip'>('auto');
  const [recordTwd, setRecordTwd] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteLedger, setDeleteLedger] = useState(true);

  const visitEntries =
    useLiveQuery(
      async () => (visitChoice !== 'new' && visitChoice !== 'none' ? db.ledger.where('visitId').equals(visitChoice).toArray() : []),
      [visitChoice],
    ) ?? ([] as LedgerEntry[]);
  const balance = visitChoice === 'none' ? null : visitChoice === 'new' ? STARTING_KIDZOS : sumKidzos(visitEntries);
  const delta = job.kidzoDelta ?? 0;
  const insufficient = delta < 0 && balance !== null && balance + delta < 0;
  const charge = chargeChoice === 'auto' ? !insufficient : chargeChoice === 'charge';

  async function resolveVisitId(): Promise<string | undefined> {
    if (visitChoice === 'none') return undefined;
    if (visitChoice === 'new') return (await createVisit({ visitDate: date ?? undefined })).id;
    return visitChoice;
  }

  async function submit() {
    if (at === null) {
      setError('請填寫完成時間');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const visitId = await resolveVisitId();
      if (editing) {
        await updateCompletion(editing.id, { completedAt: at, visitId: visitId ?? null, note, photo });
        navigate(-1);
        return;
      }
      const { entries } = await addCompletion({
        jobId: job.id,
        completedAt: at,
        visitId,
        photo: photo ?? undefined,
        note,
        chargeKidzos: charge,
        recordTwd,
      });
      void requestPersistence();
      const k = entries.find((e) => e.currency === 'kidZos');
      const t = entries.find((e) => e.currency === 'TWD');
      let ledgerLine: string | null = null;
      if (k && visitId) {
        const bal = sumKidzos(await db.ledger.where('visitId').equals(visitId).toArray());
        ledgerLine = `${formatKidzos(k.amount)}，這次入園餘額 ${formatKidzos(bal, false)}`;
      } else if (k) ledgerLine = formatKidzos(k.amount);
      if (t) ledgerLine = `${ledgerLine ? `${ledgerLine}；` : ''}自費 ${formatNtd(-t.amount)}`;
      setDone({ index: priorCount + 1, at, tilt: stampTilt(`${job.id}-${priorCount + 1}`), ledgerLine });
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setBusy(true);
    await deleteCompletion(editing.id, { keepLedger: !deleteLedger });
    navigate(-1);
  }

  if (done) {
    return (
      <StampAnimation
        name={job.nameZh}
        at={done.at}
        index={done.index}
        tilt={done.tilt}
        sound={soundOn}
        message={
          <>
            <p className="text-2xl font-black">
              {child.name ? `${displayName}完成了` : '完成了'}「{job.nameZh}」！
            </p>
            {done.index > 1 && <p className="mt-1 text-sm font-bold text-brand">第 {done.index} 次體驗</p>}
            {done.ledgerLine && <p className="mt-2 text-sm text-ink/70">{done.ledgerLine}</p>}
          </>
        }
        actions={
          <>
            <button type="button" onClick={() => navigate('/', { replace: true })} className="rounded-2xl bg-brand py-3.5 font-bold text-white">
              找下一個職業
            </button>
            <button type="button" onClick={() => navigate('/passport', { replace: true })} className="rounded-2xl bg-white py-3.5 font-bold ring-1 ring-ink/15">
              看護照
            </button>
            <button type="button" onClick={() => navigate(-1)} className="py-2 text-sm font-bold text-ink/60">
              回到職業頁
            </button>
          </>
        }
      />
    );
  }

  return (
    <>
      <PageHeader title={editing ? '編輯紀錄' : '蓋章'} />
      <main className="mx-auto max-w-md px-4 pt-2 pb-36">
        <div className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-ink/5">
          <MapNoBadge mapNo={job.mapNo} floor={job.floor} />
          <div className="min-w-0">
            <p className="font-bold">{job.nameZh}</p>
            <p className="truncate text-xs text-ink/55">
              {formatFloor(job.floor)}・{job.venueZh}
            </p>
          </div>
          {!editing && priorCount > 0 && <span className="ml-auto shrink-0 text-xs font-bold text-brand">第 {priorCount + 1} 次</span>}
        </div>
        {!editing && ageBlocked && (
          <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-stone-100 p-2.5 text-sm text-stone-700">
            <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
            官方年齡為 {formatAgeReq(job)}，{displayName}目前未達到。仍可蓋章紀錄。
          </p>
        )}

        <Field label="照片（選填）">
          <PhotoPicker value={photo} existingUrl={existingPhoto} onChange={setPhoto} />
        </Field>

        <Field label="完成時間">
          <input type="datetime-local" value={whenInput} onChange={(e) => setWhenInput(e.target.value)} className={inputCls} />
        </Field>

        <Field
          label="歸入哪次入園"
          hint={visitChoice === 'new' ? `會同時記一筆入園起始資金 +${STARTING_KIDZOS} kidZos（之後可在錢包修改）。` : undefined}
        >
          <select
            value={visitChoice}
            onChange={(e) => {
              setVisitTouched(true);
              setVisitChoice(e.target.value);
            }}
            className={inputCls}
          >
            {date && !visits.some((v) => v.visitDate === date) && <option value="new">建立 {formatISODate(date)} 入園紀錄</option>}
            {visits.map((v) => (
              <option key={v.id} value={v.id}>
                {formatISODate(v.visitDate)} 入園
              </option>
            ))}
            {date && visits.some((v) => v.visitDate === date) && <option value="new">另建 {formatISODate(date)} 入園紀錄</option>}
            <option value="none">不歸入任何入園</option>
          </select>
        </Field>

        {!editing && (
          <Field label="kidZos／費用">
            <EconomyBox
              job={job}
              balance={balance}
              insufficient={insufficient}
              charge={charge}
              setCharge={(v) => setChargeChoice(v ? 'charge' : 'skip')}
              recordTwd={recordTwd}
              setRecordTwd={setRecordTwd}
            />
          </Field>
        )}
        {editing && (
          <Field label="kidZos／費用" hint="自動記的帳會跟著改時間與入園；金額請到錢包頁修改。">
            {linked.length ? (
              <ul className="rounded-2xl bg-white px-4 py-1 text-sm ring-1 ring-ink/5">
                {linked.map((e) => (
                  <li key={e.id} className="py-2">
                    {e.currency === 'TWD' ? `自費 ${formatNtd(-e.amount)}` : formatKidzos(e.amount)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl bg-white p-3 text-sm text-ink/55 ring-1 ring-ink/5">這筆紀錄沒有自動記帳。</p>
            )}
          </Field>
        )}

        <Field label="備註（選填）">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={200} placeholder="例如：最喜歡穿制服的部分" className={inputCls} />
        </Field>

        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

        {editing && (
          <button type="button" onClick={() => setConfirmDelete(true)} className="mt-8 w-full rounded-2xl py-3 text-sm font-bold text-red-700 ring-1 ring-red-200">
            刪除這筆紀錄
          </button>
        )}
      </main>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-paper via-paper to-paper/0 px-4 pt-6 pb-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-2xl bg-brand py-4 text-lg font-black text-white shadow-lg shadow-brand/30 disabled:opacity-60"
        >
          <IconStamp className="h-6 w-6" />
          {busy ? '儲存中…' : editing ? '儲存修改' : '蓋章！'}
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="刪除這筆紀錄？"
        confirmLabel="刪除"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      >
        <p>照片與印章會一起刪除，無法復原。</p>
        {linked.length > 0 && (
          <label className="mt-3 flex items-center gap-2">
            <input type="checkbox" checked={deleteLedger} onChange={(e) => setDeleteLedger(e.target.checked)} className="h-5 w-5 accent-brand" />
            一併刪除自動記的 {linked.length} 筆帳
          </label>
        )}
      </ConfirmDialog>
    </>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-start gap-2.5 py-1">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-brand" />
      <span className="text-sm">{children}</span>
    </label>
  );
}

function EconomyBox({
  job,
  balance,
  insufficient,
  charge,
  setCharge,
  recordTwd,
  setRecordTwd,
}: {
  job: Job;
  balance: number | null;
  insufficient: boolean;
  charge: boolean;
  setCharge: (v: boolean) => void;
  recordTwd: boolean;
  setRecordTwd: (v: boolean) => void;
}) {
  const d = job.kidzoDelta;
  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-ink/5">
      {d !== null && d > 0 && (
        <Check checked={charge} onChange={setCharge}>
          自動記 <b className="text-earn">{formatKidzos(d)}</b>
          {balance !== null && <span className="text-ink/55">（餘額 {balance} → {balance + d}）</span>}
        </Check>
      )}
      {d !== null && d < 0 && (
        <>
          {insufficient && (
            <p className="mb-2 flex items-start gap-1.5 rounded-xl bg-amber-50 p-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
              <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
              這次入園餘額只剩 {balance} kidZos，不夠付 {-d}。現場可能用別的方式支付，預設只蓋章不扣；要扣款請勾選。
            </p>
          )}
          <Check checked={charge} onChange={setCharge}>
            自動扣 <b className="text-spend">{formatKidzos(-d, false)}</b>
            {balance !== null && (
              <span className="text-ink/55">
                （{charge ? '餘額' : '若扣款：'}
                {balance} → {balance + d < 0 ? `−${-(balance + d)}` : balance + d}）
              </span>
            )}
          </Check>
        </>
      )}
      {job.ntdFee !== null && (
        <Check checked={recordTwd} onChange={setRecordTwd}>
          記一筆自費 <b className="text-twd">{formatNtd(job.ntdFee)}</b>
          <span className="text-ink/55">（另計，不影響 kidZos）</span>
        </Check>
      )}
      {d === null && job.ntdFee === null && <p className="text-sm text-ink/55">官方未列收支。若現場有收付，之後可到錢包手動記帳。</p>}
    </div>
  );
}
