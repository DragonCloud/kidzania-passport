import type { AppDB } from '../db/db';
import type { ChildProfile, Completion, LedgerEntry } from '../types/models';
import { jobById } from './jobs';
import { applyJobPerk, autoKidzosNote, isPassportValidAt, levelAt } from './passport';

/**
 * 依護照（辦理、升級時間）重算蓋章自動產生的 kidZos 帳。
 * - 用 put 更新同一個 id，不新增、不刪除（同步安全）
 * - 蓋章時沒選「套用護照加碼」的不動（舊資料沒有 passportPerk：帳上有 passportBonus 視為有選）
 * - 金額被手動改過（≠ 表定＋加碼）的不動
 * - 辦理前的章：回到表定值、移除 passportBonus；辦理後：依當時等級
 * 必須在包含 child、completions、ledger、outbox 的交易內呼叫。回傳更新的筆數。
 */
export async function recalcPassportEntries(d: AppDB, completionIds?: string[]): Promise<number> {
  const child = (await d.child.get('kid')) ?? null;
  const comps: Completion[] = completionIds
    ? (await d.completions.bulkGet(completionIds)).filter((c): c is Completion => !!c)
    : await d.completions.toArray();
  if (!comps.length) return 0;
  const want = new Set(comps.map((c) => c.id));
  const entries = await d.ledger
    .filter((e) => !!e.completionId && want.has(e.completionId) && e.currency === 'kidZos' && (e.type === 'earn' || e.type === 'spend'))
    .toArray();
  const byCompletion = new Map<string, LedgerEntry[]>();
  for (const e of entries) byCompletion.set(e.completionId!, [...(byCompletion.get(e.completionId!) ?? []), e]);

  let changed = 0;
  for (const c of comps) {
    for (const e of byCompletion.get(c.id) ?? []) {
      const next = recalcEntry(e, c, child);
      if (next) {
        await d.ledger.put(next);
        changed += 1;
      }
    }
  }
  return changed;
}

/** 回傳要寫回的帳；不需要變更時回傳 null */
export function recalcEntry(e: LedgerEntry, c: Completion, child: Pick<ChildProfile, 'passport' | 'birthday'> | null): LedgerEntry | null {
  const job = jobById(c.jobId);
  const base = job?.kidzoDelta;
  if (!job || !base) return null;
  const oldBonus = e.passportBonus ?? 0;
  if (e.amount !== base + oldBonus) return null; // 手動改過金額
  const chosen = c.passportPerk ?? oldBonus > 0;
  if (!chosen) return null;
  const p = child?.passport ?? null;
  const level = isPassportValidAt(p, child?.birthday ?? null, c.completedAt) ? levelAt(p, c.completedAt) : null;
  const { amount, bonus } = level ? applyJobPerk(base, level) : { amount: base, bonus: 0 };
  const autoNote = e.note === undefined || e.note === job.nameZh || e.note.startsWith(`${job.nameZh}（`);
  const note = autoNote ? autoKidzosNote(job.nameZh, level, base, bonus) : e.note;
  if (amount === e.amount && bonus === oldBonus && note === e.note) return null;
  const next: LedgerEntry = { ...e, amount, note };
  if (bonus) next.passportBonus = bonus;
  else delete next.passportBonus;
  return next;
}
