import { STARTING_KIDZOS } from '../config/defaults';
import { db, newId, type AppDB } from '../db/db';
import type { LedgerEntry, Visit } from '../types/models';
import { todayISO } from './age';
import { sumKidzos } from './ledger';

/**
 * 每次入園建立一筆 Visit，並同時寫一筆 grant 帳（起始資金）。
 * 起始資金預設 50，可改成上次留下的餘額。
 */
export async function createVisit(
  input: { visitDate?: string; startingKidzos?: number; notes?: string } = {},
  d: AppDB = db,
): Promise<Visit> {
  const visit: Visit = {
    id: newId(),
    visitDate: input.visitDate ?? todayISO(),
    startingKidzos: input.startingKidzos ?? STARTING_KIDZOS,
    notes: input.notes?.trim() || undefined,
    createdAt: Date.now(),
  };
  if (!Number.isFinite(visit.startingKidzos) || visit.startingKidzos < 0) throw new Error('起始資金需為 0 以上');
  await d.transaction('rw', d.visits, d.ledger, async () => {
    await d.visits.add(visit);
    if (visit.startingKidzos > 0) await d.ledger.add(grantEntry(visit));
  });
  return visit;
}

function grantEntry(visit: Visit): LedgerEntry {
  return {
    id: newId(),
    visitId: visit.id,
    at: dateStartMs(visit.visitDate),
    type: 'grant',
    amount: visit.startingKidzos,
    currency: 'kidZos',
    note: '入園起始資金',
  };
}

/** 'YYYY-MM-DD' 的當地 00:00 */
export function dateStartMs(iso: string): number {
  const [y, m, dd] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, dd ?? 1).getTime();
}

export async function updateVisit(
  id: string,
  patch: Partial<Pick<Visit, 'visitDate' | 'startingKidzos' | 'notes'>>,
  d: AppDB = db,
): Promise<void> {
  await d.transaction('rw', d.visits, d.ledger, async () => {
    const visit = await d.visits.get(id);
    if (!visit) throw new Error('找不到這次入園紀錄');
    const next: Visit = { ...visit, ...patch };
    if (!Number.isFinite(next.startingKidzos) || next.startingKidzos < 0) throw new Error('起始資金需為 0 以上');
    await d.visits.put(next);
    const grants = await d.ledger.where('visitId').equals(id).filter((e) => e.type === 'grant').toArray();
    await d.ledger.bulkDelete(grants.map((g) => g.id));
    if (next.startingKidzos > 0) await d.ledger.add(grantEntry(next));
  });
}

/**
 * 刪除入園紀錄。
 * keepRecords=true（預設）：完成紀錄與手動帳保留，只解除關聯；起始資金那筆刪除。
 */
export async function deleteVisit(id: string, opts: { keepRecords?: boolean } = {}, d: AppDB = db): Promise<void> {
  const keep = opts.keepRecords ?? true;
  await d.transaction('rw', [d.visits, d.ledger, d.completions, d.blobs], async () => {
    const entries = await d.ledger.where('visitId').equals(id).toArray();
    const comps = await d.completions.where('visitId').equals(id).toArray();
    if (keep) {
      await d.ledger.bulkDelete(entries.filter((e) => e.type === 'grant').map((e) => e.id));
      for (const e of entries) if (e.type !== 'grant') await d.ledger.update(e.id, { visitId: undefined });
      for (const c of comps) await d.completions.update(c.id, { visitId: undefined });
    } else {
      await d.ledger.bulkDelete(entries.map((e) => e.id));
      await d.blobs.bulkDelete(comps.flatMap((c) => [c.photoBlobId, c.thumbBlobId]).filter((x): x is string => !!x));
      await d.completions.bulkDelete(comps.map((c) => c.id));
    }
    await d.visits.delete(id);
  });
}

export async function visitForDate(date: string, d: AppDB = db): Promise<Visit | undefined> {
  const list = await d.visits.where('visitDate').equals(date).sortBy('createdAt');
  return list.at(-1);
}

export async function listVisits(d: AppDB = db): Promise<Visit[]> {
  const list = await d.visits.toArray();
  return list.sort((a, b) => (a.visitDate === b.visitDate ? b.createdAt - a.createdAt : a.visitDate < b.visitDate ? 1 : -1));
}

/** 最近一次（不含 excludeId）入園結束時的 kidZos 餘額，供下次當起始資金參考 */
export async function previousVisitBalance(excludeId?: string, d: AppDB = db): Promise<{ visit: Visit; balance: number } | null> {
  const prev = (await listVisits(d)).find((v) => v.id !== excludeId);
  if (!prev) return null;
  const entries = await d.ledger.where('visitId').equals(prev.id).toArray();
  return { visit: prev, balance: sumKidzos(entries) };
}
