import { useState } from 'react';
import { addManualEntry, deleteEntry, LEDGER_TYPE_LABEL, MANUAL_TYPES, updateEntry } from '../lib/ledger';
import { formatDateTime, fromLocalInput, toLocalInput } from '../lib/format';
import { jobById } from '../lib/jobs';
import type { LedgerEntry, LedgerType, TwdCategory } from '../types/models';
import { BottomSheet } from './BottomSheet';
import { usePassport } from '../hooks/usePassport';
import { MANUAL_TWD_CATEGORIES, TWD_CATEGORY_LABEL, twdCategoryOf } from '../lib/costs';
import { localDateISO } from '../lib/format';
import { isPassportValidOn, LEVEL_LABEL, levelOn, PERKS } from '../lib/passport';

/** 各類型的正負號規則：fixed＝固定方向；choose＝讓使用者選 */
const SIGN_RULE: Record<LedgerType, { fixed?: 1 | -1; plus?: string; minus?: string }> = {
  grant: { fixed: 1 },
  earn: { fixed: 1 },
  spend: { fixed: -1 },
  purchase: { fixed: -1 },
  donate: { fixed: -1 },
  twd_fee: { fixed: -1 },
  atm: { plus: '提款（＋）', minus: '存入銀行（−）' },
  adjust: { plus: '增加', minus: '減少' },
};

const HINT: Partial<Record<LedgerType, string>> = {
  purchase: '在購物中心用 kidZos 換禮物',
  donate: '捐出 kidZos',
  atm: '用 kidZos 金融卡提款或存入',
  adjust: '和現場實際餘額對不上時修正',
  twd_fee: '園內另外用新臺幣付費的項目（不影響 kidZos）',
};

const inputCls =
  'w-full rounded-xl bg-white px-3 py-2.5 text-base ring-1 ring-ink/15 outline-none focus:ring-2 focus:ring-brand';

/**
 * 新增手動帳（entry 為 null）或編輯既有帳。
 * 蓋章自動產生的帳也可在這裡改金額或刪除。
 */
export function LedgerEntryForm({
  open,
  entry,
  visitId,
  onClose,
}: {
  open: boolean;
  entry: LedgerEntry | null;
  visitId?: string;
  onClose: () => void;
}) {
  return open ? <Inner key={entry?.id ?? 'new'} entry={entry} visitId={visitId} onClose={onClose} /> : null;
}

function Inner({ entry, visitId, onClose }: { entry: LedgerEntry | null; visitId?: string; onClose: () => void }) {
  const [type, setType] = useState<LedgerType>(entry?.type ?? 'purchase');
  const [sign, setSign] = useState<1 | -1>(entry ? (entry.amount < 0 ? -1 : 1) : 1);
  const [amount, setAmount] = useState(entry ? String(Math.abs(entry.amount)) : '');
  const [note, setNote] = useState(entry?.note ?? '');
  const [when, setWhen] = useState(toLocalInput(entry?.at ?? Date.now()));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<TwdCategory>(entry ? twdCategoryOf(entry) : 'other');
  // 舊版手動記的「門票」「護照費」：照常顯示、可刪，但不再提供這兩個分類
  const legacyCategory = !!entry && (category === 'ticket' || category === 'passport');
  const [bonus, setBonus] = useState(entry?.passportBonus ?? 0);
  const [items, setItems] = useState(1);
  const pass = usePassport();

  const rule = SIGN_RULE[type];
  const effectiveSign = rule.fixed ?? sign;
  const isAuto = !!entry && (entry.type === 'grant' || entry.type === 'earn' || entry.type === 'spend' || !!entry.completionId);
  const currency = type === 'twd_fee' ? 'TWD' : 'kidZos';
  const job = entry?.jobId ? jobById(entry.jobId) : undefined;
  const whenMs = fromLocalInput(when);
  const whenDay = whenMs === null ? pass.today : localDateISO(whenMs);
  const perkLevel = pass.passport && isPassportValidOn(pass.passport, pass.birthday, whenDay) ? levelOn(pass.passport, whenDay) : null;
  const shopCut = perkLevel ? PERKS[perkLevel].shopPerItem * items : 0;

  async function save() {
    const n = Number(amount);
    const at = fromLocalInput(when);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      setError('請輸入大於 0 的整數');
      return;
    }
    if (at === null) {
      setError('請填寫時間');
      return;
    }
    setBusy(true);
    try {
      const extra = {
        ...(currency === 'TWD' ? { twdCategory: category } : {}),
        ...(type === 'purchase' ? { passportBonus: bonus || undefined } : {}),
      };
      if (entry) await updateEntry(entry.id, { amount: effectiveSign * n, note: note.trim() || undefined, at, ...(isAuto ? {} : { type }), ...extra });
      else await addManualEntry({ visitId, type, amount: effectiveSign * n, currency, note, at, ...extra });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
      setBusy(false);
    }
  }

  async function remove() {
    if (!entry) return;
    setBusy(true);
    await deleteEntry(entry.id);
    onClose();
  }

  return (
    <BottomSheet
      open
      title={entry ? '修改帳目' : '記一筆'}
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          {entry && (
            <button type="button" disabled={busy} onClick={() => void remove()} className="rounded-2xl px-4 py-3 font-bold text-red-700 ring-1 ring-red-200">
              刪除
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void save()} className="flex-1 rounded-2xl bg-brand py-3 font-bold text-white disabled:opacity-60">
            儲存
          </button>
        </div>
      }
    >
      {isAuto ? (
        <p className="mt-2 rounded-xl bg-ink/[0.04] p-3 text-sm text-ink/70">
          {LEDGER_TYPE_LABEL[entry!.type]}
          {job ? `・${job.nameZh}` : ''}（{entry!.type === 'grant' ? '入園時自動記錄' : '蓋章時自動記錄'}，可改金額或刪除）
          <br />
          <span className="text-xs text-ink/50">{formatDateTime(entry!.at)}</span>
        </p>
      ) : (
        <>
          <h3 className="mt-3 mb-2 text-sm font-bold text-ink/70">類型</h3>
          <div className="flex flex-wrap gap-2">
            {MANUAL_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                onClick={() => setType(t)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${type === t ? 'bg-ink text-white ring-ink' : 'bg-white ring-ink/15'}`}
              >
                {LEDGER_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          {HINT[type] && <p className="mt-1.5 text-xs text-ink/50">{HINT[type]}</p>}
        </>
      )}

      {!rule.fixed && (
        <div className="mt-4 flex rounded-2xl bg-ink/[0.06] p-1">
          {([1, -1] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={sign === s}
              onClick={() => setSign(s)}
              className={`flex-1 rounded-xl py-2 text-sm font-bold ${sign === s ? 'bg-white shadow-sm' : 'text-ink/55'}`}
            >
              {s === 1 ? rule.plus : rule.minus}
            </button>
          ))}
        </div>
      )}

      <label className="mt-4 block">
        <span className="text-sm font-bold text-ink/70">金額（{currency === 'TWD' ? '新臺幣' : 'kidZos'}）</span>
        <div className="mt-1 flex items-center gap-2">
          <span className={`w-6 text-center text-2xl font-black ${effectiveSign > 0 ? 'text-earn' : 'text-spend'}`}>{effectiveSign > 0 ? '+' : '−'}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className={`${inputCls} text-xl font-bold tabular-nums`}
          />
        </div>
      </label>

      {type === 'purchase' && perkLevel && (
        <div className="mt-3 rounded-2xl bg-brand/5 p-3 ring-1 ring-brand/20">
          {bonus > 0 ? (
            <p className="flex items-center justify-between gap-2 text-sm">
              <span>
                已套用{LEVEL_LABEL[perkLevel]}減免，少付 <b>{bonus}</b> kidZos
              </span>
              <button
                type="button"
                onClick={() => {
                  setAmount(String((Number(amount) || 0) + bonus));
                  setBonus(0);
                }}
                className="text-xs font-bold text-ink/50 underline"
              >
                取消
              </button>
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-sm">
                {LEVEL_LABEL[perkLevel]}每件少 {PERKS[perkLevel].shopPerItem}
                <span className="block text-xs text-ink/50">金額先填原價合計</span>
              </span>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={items}
                  onChange={(e) => setItems(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  className="w-12 rounded-lg bg-white px-1.5 py-1 text-center tabular-nums ring-1 ring-ink/15"
                  aria-label="件數"
                />
                件
              </label>
              <button
                type="button"
                disabled={!(Number(amount) > 0)}
                onClick={() => {
                  const list = Number(amount) || 0;
                  const cut = Math.min(shopCut, list);
                  setAmount(String(list - cut));
                  setBonus(cut);
                }}
                className="rounded-full bg-brand px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40"
              >
                套用減免
              </button>
            </div>
          )}
        </div>
      )}

      {currency === 'TWD' &&
        (legacyCategory ? (
          <p className="mt-4 rounded-xl bg-ink/[0.04] p-3 text-sm text-ink/70">
            分類：<b>{TWD_CATEGORY_LABEL[category]}</b>
            <span className="block text-xs text-ink/50">
              {category === 'ticket' ? '門票請在錢包的「記錄門票」填寫。' : '護照費請在設定頁的「市民護照」管理。'}這筆可以照常修改金額或刪除。
            </span>
          </p>
        ) : (
          <>
            <h3 className="mt-4 mb-2 text-sm font-bold text-ink/70">支出分類</h3>
            <div className="flex flex-wrap gap-2">
              {MANUAL_TWD_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={category === c}
                  onClick={() => setCategory(c)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${category === c ? 'bg-ink text-white ring-ink' : 'bg-white ring-ink/15'}`}
                >
                  {TWD_CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink/50">門票請用錢包的「記錄門票」，護照費在設定頁「市民護照」，避免重複計算。</p>
          </>
        ))}

      <label className="mt-4 block">
        <span className="text-sm font-bold text-ink/70">時間</span>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={`${inputCls} mt-1`} />
      </label>

      <label className="mt-4 block">
        <span className="text-sm font-bold text-ink/70">備註（選填）</span>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={60} placeholder="例如：換了貼紙" className={`${inputCls} mt-1`} />
      </label>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    </BottomSheet>
  );
}
