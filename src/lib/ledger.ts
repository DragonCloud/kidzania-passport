import { db, newId, type AppDB } from '../db/db';
import type { Currency, Job, LedgerEntry, LedgerType, PassportLevel, TwdCategory } from '../types/models';
import { applyJobPerk, autoKidzosNote } from './passport';

export const LEDGER_TYPE_LABEL: Record<LedgerType, string> = {
  grant: '入園起始資金',
  earn: '職業賺得',
  spend: '職業支付',
  adjust: '手動調整',
  purchase: '購物中心兌換',
  donate: '捐款',
  atm: 'ATM／銀行',
  twd_fee: '自費（新臺幣）',
};

/** 手動記帳可選的類型（grant／earn／spend 由系統產生） */
export const MANUAL_TYPES: LedgerType[] = ['purchase', 'donate', 'atm', 'adjust', 'twd_fee'];

/** kidZos 淨額（含起始資金） */
export function sumKidzos(entries: LedgerEntry[]): number {
  return entries.reduce((s, e) => (e.currency === 'kidZos' ? s + e.amount : s), 0);
}

/** 新臺幣自費總額，以正數表示 */
export function sumTwdSpent(entries: LedgerEntry[]): number {
  const spent = -entries.reduce((s, e) => (e.currency === 'TWD' ? s + e.amount : s), 0);
  return spent === 0 ? 0 : spent; // -0 → 0
}

/**
 * 蓋章時依職業表定自動產生的帳（純函式，不寫入）。
 * - kidzoDelta 有值 → earn／spend（kidZos）
 * - ntdFee 有值 → twd_fee（TWD，負數）
 * - 都沒有（例如披薩、大學）→ 不記帳，由使用者手動補
 */
export function autoEntriesForJob(
  job: Pick<Job, 'id' | 'nameZh' | 'kidzoDelta' | 'ntdFee'>,
  ctx: { completionId: string; visitId?: string; at: number },
  opts: { chargeKidzos?: boolean; recordTwd?: boolean; perkLevel?: PassportLevel | null } = {},
): LedgerEntry[] {
  const { chargeKidzos = true, recordTwd = true, perkLevel = null } = opts;
  const base = { visitId: ctx.visitId, at: ctx.at, jobId: job.id, completionId: ctx.completionId };
  const out: LedgerEntry[] = [];
  if (chargeKidzos && job.kidzoDelta !== null && job.kidzoDelta !== 0) {
    const earn = job.kidzoDelta > 0;
    const perk = perkLevel ? applyJobPerk(job.kidzoDelta, perkLevel) : null;
    const bonus = perk?.bonus ?? 0;
    out.push({
      ...base,
      id: newId(),
      type: earn ? 'earn' : 'spend',
      amount: perk ? perk.amount : job.kidzoDelta,
      currency: 'kidZos',
      note: autoKidzosNote(job.nameZh, perkLevel, job.kidzoDelta, bonus),
      ...(bonus ? { passportBonus: bonus } : {}),
    });
  }
  if (recordTwd && job.ntdFee !== null && job.ntdFee !== 0) {
    out.push({
      ...base,
      id: newId(),
      type: 'twd_fee',
      amount: -Math.abs(job.ntdFee),
      currency: 'TWD',
      note: job.nameZh,
      twdCategory: 'job',
    });
  }
  return out;
}

export async function entriesForVisit(visitId: string, d: AppDB = db): Promise<LedgerEntry[]> {
  return d.ledger.where('visitId').equals(visitId).sortBy('at');
}

export async function balanceForVisit(visitId: string, d: AppDB = db): Promise<number> {
  return sumKidzos(await entriesForVisit(visitId, d));
}

export interface ManualEntryInput {
  visitId?: string;
  type: LedgerType;
  /** 帶正負號 */
  amount: number;
  currency?: Currency;
  note?: string;
  at?: number;
  /** twd_fee 的分類 */
  twdCategory?: TwdCategory;
  /** 購物中心等套用護照減免的 kidZos（正數） */
  passportBonus?: number;
}

export async function addManualEntry(input: ManualEntryInput, d: AppDB = db): Promise<LedgerEntry> {
  if (!Number.isFinite(input.amount) || input.amount === 0) throw new Error('金額不可為 0');
  const currency: Currency = input.currency ?? (input.type === 'twd_fee' ? 'TWD' : 'kidZos');
  const entry: LedgerEntry = {
    id: newId(),
    visitId: input.visitId,
    at: input.at ?? Date.now(),
    type: input.type,
    amount: input.amount,
    currency,
    note: input.note?.trim() || undefined,
    ...(currency === 'TWD' && input.twdCategory ? { twdCategory: input.twdCategory } : {}),
    ...(currency === 'kidZos' && input.passportBonus ? { passportBonus: input.passportBonus } : {}),
  };
  await d.ledger.add(entry);
  return entry;
}

export async function updateEntry(
  id: string,
  patch: Partial<Pick<LedgerEntry, 'amount' | 'note' | 'at' | 'type' | 'visitId' | 'twdCategory' | 'passportBonus'>>,
  d: AppDB = db,
): Promise<void> {
  if (patch.amount !== undefined && (!Number.isFinite(patch.amount) || patch.amount === 0)) {
    throw new Error('金額不可為 0');
  }
  await d.ledger.update(id, patch);
}

export async function deleteEntry(id: string, d: AppDB = db): Promise<void> {
  await d.ledger.delete(id);
}
