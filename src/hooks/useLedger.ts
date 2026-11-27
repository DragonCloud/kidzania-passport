import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { sumKidzos, sumTwdSpent } from '../lib/ledger';
import type { LedgerEntry } from '../types/models';

const EMPTY: LedgerEntry[] = [];

/**
 * visitId 有值：該次入園的帳；undefined：全部帳。
 * 回傳新→舊排序與 kidZos 餘額、新臺幣自費合計。
 */
export function useLedger(visitId?: string): { entries: LedgerEntry[]; kidzos: number; twdSpent: number } {
  const entries =
    useLiveQuery(async () => {
      const list = visitId ? await db.ledger.where('visitId').equals(visitId).toArray() : await db.ledger.toArray();
      return list.sort((a, b) => b.at - a.at);
    }, [visitId]) ?? EMPTY;
  return { entries, kidzos: sumKidzos(entries), twdSpent: sumTwdSpent(entries) };
}
