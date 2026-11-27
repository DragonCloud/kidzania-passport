import { useState } from 'react';
import { usePassport } from '../../hooks/usePassport';
import { formatISODate, formatNtd, localDateISO } from '../../lib/format';
import {
  localMidnight,
  discountLabel,
  LEVEL_LABEL,
  NEXT_LEVEL,
  PASSPORT_FEE,
  PASSPORT_SOURCE,
  PERKS,
  REPLACEMENT_FEE,
} from '../../lib/passport';
import { addReplacement, recordUpgrade, removePassport, removeReplacement, savePassport, undoUpgrade } from '../../lib/passportStore';
import type { PassportLevel } from '../../types/models';
import { BottomSheet } from '../BottomSheet';
import { ConfirmDialog } from '../ConfirmDialog';
import { IconAlert } from '../icons';
import { LevelChip } from './LevelChip';
import { PassportFixBanner, useDateTime } from './PassportFix';
import { formatDateTime } from '../../lib/format';

export const inputCls =
  'w-full rounded-xl bg-white px-3 py-2.5 text-base ring-1 ring-ink/15 outline-none focus:ring-2 focus:ring-brand';

/** 設定頁「市民護照」區塊 */
export function PassportSettings({ onMessage }: { onMessage: (m: string) => void }) {
  const s = usePassport();
  const [edit, setEdit] = useState(false);
  const [upgrade, setUpgrade] = useState(false);
  const [replace, setReplace] = useState(false);
  const [remove, setRemove] = useState(false);
  if (!s.loaded) return null;
  const p = s.passport;

  return (
    <>
      {!p ? (
        <div>
          <p className="text-sm text-ink/65">
            B·KidZanian 市民護照：辦理費 {formatNtd(PASSPORT_FEE)}、沒有年費、不含門票；辦好當天起，賺 kidZos 加碼、付 kidZos 少付。
          </p>
          <button type="button" onClick={() => setEdit(true)} className="mt-3 w-full rounded-2xl bg-brand py-3 font-bold text-white">
            記錄已辦的市民護照
          </button>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between gap-2">
            <LevelChip level={s.level!} />
            <button type="button" onClick={() => setEdit(true)} className="rounded-full px-3 py-1.5 text-sm font-bold text-brand ring-1 ring-brand/30">
              編輯
            </button>
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-ink/55">辦理日</dt>
            <dd>
              {p.issuedAt !== undefined ? formatDateTime(p.issuedAt) : formatISODate(p.issuedOn)}・{p.fee > 0 ? formatNtd(p.fee) : '免費'}
            </dd>
            {p.upgrades.map((u) => (
              <FragmentRow key={u.level} label={`升${LEVEL_LABEL[u.level]}`} value={u.at !== undefined ? formatDateTime(u.at) : formatISODate(u.date)} />
            ))}
            {p.replacements.map((r, i) => (
              <FragmentRow
                key={`${r.date}-${i}`}
                label="遺失補發"
                value={
                  <span className="flex items-center justify-between gap-2">
                    {formatISODate(r.date)}・{formatNtd(r.fee)}
                    <button type="button" className="text-xs text-ink/45 underline" onClick={() => void removeReplacement(i).then(() => onMessage('已刪除補發紀錄'))}>
                      刪除
                    </button>
                  </span>
                }
              />
            ))}
            <dt className="text-ink/55">有效至</dt>
            <dd className={s.expiry.state === 'soon' || s.expiry.state === 'expired' ? 'font-bold text-amber-800' : ''}>
              {s.expiry.expiry ? (
                <>
                  {formatISODate(s.expiry.expiry)}
                  <span className="text-xs text-ink/50">（18 歲生日前一天）</span>
                </>
              ) : (
                <span className="text-ink/50">填寫孩子生日後自動計算</span>
              )}
            </dd>
          </dl>
          <PassportFixBanner onMessage={onMessage} />
          {s.expiry.state === 'expired' && (
            <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-amber-50 p-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
              <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
              護照已過期，蓋章不再套用加碼。
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!NEXT_LEVEL[s.level!]}
              onClick={() => setUpgrade(true)}
              className="rounded-2xl bg-ink py-2.5 text-sm font-bold text-white disabled:opacity-40"
            >
              {NEXT_LEVEL[s.level!] ? `記錄升${LEVEL_LABEL[NEXT_LEVEL[s.level!]!]}` : '已是最高等級'}
            </button>
            <button type="button" onClick={() => setReplace(true)} className="rounded-2xl py-2.5 text-sm font-bold ring-1 ring-ink/15">
              記錄遺失補發
            </button>
          </div>
          {p.upgrades.length > 0 && (
            <button type="button" onClick={() => void undoUpgrade().then(() => onMessage('已取消最近一次升級'))} className="mt-2 text-xs text-ink/50 underline">
              記錯了？取消最近一次升級
            </button>
          )}
        </div>
      )}

      <PerkTable current={s.level} />

      <p className="mt-3 text-[11px] leading-relaxed text-ink/45">
        資料來源：{PASSPORT_SOURCE.label}（{PASSPORT_SOURCE.readOn} 讀取）。實際權益以現場與官方公告為準；「指定職業」加碼若現場沒有給，可在蓋章時關閉「套用護照加碼」。
      </p>

      {edit && (
        <EditSheet
          onClose={() => setEdit(false)}
          onRemove={p ? () => setRemove(true) : undefined}
          onSaved={() => onMessage('已儲存市民護照')}
        />
      )}
      {upgrade && s.level && NEXT_LEVEL[s.level] && (
        <DateSheet
          title={`記錄升${LEVEL_LABEL[NEXT_LEVEL[s.level]!]}`}
          hint={`到 KidZania 現場用集滿 30 枚章的護照換發後再記錄。換發當天起套用${LEVEL_LABEL[NEXT_LEVEL[s.level]!]}權益，集章重新計算。`}
          today={s.today}
          onClose={() => setUpgrade(false)}
          onSave={async (at) => {
            await recordUpgrade(localDateISO(at), undefined, at);
            onMessage(`已升為${LEVEL_LABEL[NEXT_LEVEL[s.level!]!]}`);
          }}
        />
      )}
      {replace && (
        <DateSheet
          title="記錄遺失補發"
          hint={`補發費 ${formatNtd(REPLACEMENT_FEE)}，會記成一筆護照費。等級保留，舊護照上的章不轉移，集章從補發日重新計算。`}
          today={s.today}
          withFee={REPLACEMENT_FEE}
          onClose={() => setReplace(false)}
          onSave={async (at, fee) => {
            await addReplacement({ date: localDateISO(at), fee, at });
            onMessage('已記錄補發');
          }}
        />
      )}
      <ConfirmDialog
        open={remove}
        title="移除市民護照紀錄？"
        confirmLabel="移除"
        danger
        onCancel={() => setRemove(false)}
        onConfirm={() =>
          void removePassport().then(() => {
            setRemove(false);
            setEdit(false);
            onMessage('已移除市民護照紀錄');
          })
        }
      >
        <p>辦理費與補發費那幾筆支出也會一起刪除；蓋章時的護照加碼會改回表定值。</p>
      </ConfirmDialog>
    </>
  );
}

function FragmentRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-ink/55">{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function PerkTable({ current }: { current: PassportLevel | null }) {
  const levels: PassportLevel[] = ['model', 'outstanding', 'honor'];
  const rows: [string, (l: PassportLevel) => string][] = [
    ['指定職業薪資', (l) => `+${PERKS[l].wage}`],
    ['付費體驗', (l) => `少 ${PERKS[l].experience}`],
    ['購物中心每件', (l) => `少 ${PERKS[l].shopPerItem}`],
    ['禮品／相片中心', (l) => discountLabel(PERKS[l].giftPhotoPct)],
    ['生日券餐飲', (l) => discountLabel(PERKS[l].birthdayDiningPct)],
  ];
  return (
    <div className="mt-4 overflow-hidden rounded-2xl ring-1 ring-ink/10">
      <table className="w-full text-center text-xs">
        <thead className="bg-ink/[0.04]">
          <tr>
            <th className="py-2 pl-2 text-left font-bold text-ink/60">權益</th>
            {levels.map((l) => (
              <th key={l} className={`py-2 font-bold ${l === current ? 'text-brand' : 'text-ink/60'}`}>
                {LEVEL_LABEL[l].replace('市民', '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, fn]) => (
            <tr key={label} className="border-t border-ink/5">
              <td className="py-1.5 pl-2 text-left text-ink/70">{label}</td>
              {levels.map((l) => (
                <td key={l} className={`py-1.5 tabular-nums ${l === current ? 'bg-brand/5 font-bold' : ''}`}>
                  {fn(l)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-ink/5 px-2 py-1.5 text-left text-[11px] text-ink/50">kidZos 為園內貨幣，App 不換算成新臺幣。</p>
    </div>
  );
}

function EditSheet({ onClose, onSaved, onRemove }: { onClose: () => void; onSaved: () => void; onRemove?: () => void }) {
  const s = usePassport();
  const p = s.passport;
  const issued = useDateTime(p ? (p.issuedAt ?? localMidnight(p.issuedOn)) : null);
  const [fee, setFee] = useState(String(p?.fee ?? PASSPORT_FEE));
  const [level, setLevel] = useState<PassportLevel>('model');
  const since = useDateTime(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const n = Number(fee);
    if (!Number.isInteger(n) || n < 0) return setError('費用需為 0 以上的整數');
    setBusy(true);
    try {
      // 舊護照（沒有辦理時間）沒改時間時保持原樣，交給「一鍵修正」處理
      const keepLegacy = !!p && p.issuedAt === undefined && !issued.touched;
      const issuedAt = keepLegacy ? undefined : issued.resolve();
      if (issuedAt === null) throw new Error('請選辦理時間');
      const sinceAt = since.resolve();
      if (!p && level !== 'model' && sinceAt === null) throw new Error('請選換發時間');
      await savePassport({
        issuedOn: issuedAt === undefined ? p!.issuedOn : localDateISO(issuedAt),
        issuedAt,
        fee: n,
        ...(p || level === 'model' ? {} : { level, levelSinceAt: sinceAt! }),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open
      title={p ? '編輯市民護照' : '記錄市民護照'}
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          {onRemove && (
            <button type="button" onClick={onRemove} className="rounded-2xl px-4 py-3 font-bold text-red-700 ring-1 ring-red-200">
              移除
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void save()} className="flex-1 rounded-2xl bg-brand py-3 font-bold text-white disabled:opacity-60">
            儲存
          </button>
        </div>
      }
    >
      <label className="mt-3 block">
        <span className="text-sm font-bold text-ink/70">辦理時間</span>
        <input type="datetime-local" value={issued.value} onChange={(e) => issued.setValue(e.target.value)} className={`${inputCls} mt-1`} />
        <span className="mt-1 block text-xs text-ink/50">預設是現在。這個時間之後蓋的章才算護照章、才有加碼；之前的章仍留在印章牆，標「辦護照前」。</span>
      </label>
      <label className="mt-4 block">
        <span className="text-sm font-bold text-ink/70">辦理費（新臺幣）</span>
        <input type="number" inputMode="numeric" min={0} value={fee} onChange={(e) => setFee(e.target.value)} className={`${inputCls} mt-1 tabular-nums`} />
        <span className="mt-1 block text-xs text-ink/50">預設 {PASSPORT_FEE}；記成一筆「護照費」，不屬於任何一次入園。活動贈送可填 0。</span>
      </label>
      {!p && (
        <>
          <h3 className="mt-4 text-sm font-bold text-ink/70">目前等級</h3>
          <div className="mt-1.5 flex gap-2">
            {(['model', 'outstanding', 'honor'] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={level === l}
                onClick={() => setLevel(l)}
                className={`flex-1 rounded-full py-2 text-sm font-bold ring-1 ${level === l ? 'bg-ink text-white ring-ink' : 'bg-white ring-ink/15'}`}
              >
                {LEVEL_LABEL[l]}
              </button>
            ))}
          </div>
          {level !== 'model' && (
            <label className="mt-3 block">
              <span className="text-sm font-bold text-ink/70">升為{LEVEL_LABEL[level]}的時間</span>
              <input type="datetime-local" value={since.value} onChange={(e) => since.setValue(e.target.value)} className={`${inputCls} mt-1`} />
              <span className="mt-1 block text-xs text-ink/50">這天起套用{LEVEL_LABEL[level]}權益，集章從這天重新計算。</span>
            </label>
          )}
        </>
      )}
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    </BottomSheet>
  );
}

export function DateSheet({
  title,
  hint,
  today,
  withFee,
  onClose,
  onSave,
}: {
  title: string;
  hint: string;
  today: string;
  withFee?: number;
  onClose: () => void;
  onSave: (at: number, fee: number) => Promise<void>;
}) {
  void today;
  const dt = useDateTime(null);
  const [fee, setFee] = useState(String(withFee ?? 0));
  const [error, setError] = useState<string | null>(null);
  async function save() {
    try {
      const at = dt.resolve();
      if (at === null) return setError('請選時間');
      await onSave(at, Number(fee));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
    }
  }
  return (
    <BottomSheet
      open
      title={title}
      onClose={onClose}
      footer={
        <button type="button" onClick={() => void save()} className="w-full rounded-2xl bg-brand py-3 font-bold text-white">
          儲存
        </button>
      }
    >
      <p className="mt-2 text-sm text-ink/65">{hint}</p>
      <label className="mt-3 block">
        <span className="text-sm font-bold text-ink/70">時間</span>
        <input type="datetime-local" value={dt.value} onChange={(e) => dt.setValue(e.target.value)} className={`${inputCls} mt-1`} />
      </label>
      {withFee !== undefined && (
        <label className="mt-3 block">
          <span className="text-sm font-bold text-ink/70">費用（新臺幣）</span>
          <input type="number" inputMode="numeric" min={0} value={fee} onChange={(e) => setFee(e.target.value)} className={`${inputCls} mt-1 tabular-nums`} />
        </label>
      )}
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    </BottomSheet>
  );
}
