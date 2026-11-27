import type { LedgerEntry, TwdCategory, Visit } from '../types/models';
import { ticketTotals } from './tickets';

export const TWD_CATEGORY_LABEL: Record<TwdCategory, string> = {
  passport: '護照費',
  ticket: '門票',
  job: '職業自費',
  other: '其他',
};

/** 新臺幣支出分類；舊資料沒有 twdCategory：有 jobId 視為 job，否則 other */
export function twdCategoryOf(e: Pick<LedgerEntry, 'twdCategory' | 'jobId'>): TwdCategory {
  return e.twdCategory ?? (e.jobId ? 'job' : 'other');
}

export interface CostSummary {
  /** 新臺幣支出（正數）；門票只含「已記錄門票」的入園 */
  twd: Record<TwdCategory, number> & { total: number };
  /** 入園次數與其中未記錄門票的次數 */
  visits: number;
  ticketsUnrecorded: number;
  ticketCount: number;
  saved: {
    /** 門票：原價－實付（新臺幣） */
    ticketTwd: number;
    /** 護照帶來的 kidZos 薪資加碼累計 */
    kidzosWage: number;
    /** 護照帶來的 kidZos 減免累計（體驗少付＋購物減免） */
    kidzosDiscount: number;
  };
}

/**
 * 費用總覽。scope：
 * - { visitId }：單次入園（不含護照費等不屬於任何入園的支出）
 * - 'all'：累計
 */
export function summarizeCosts(visits: Visit[], ledger: LedgerEntry[], scope: { visitId: string } | 'all'): CostSummary {
  const vs = scope === 'all' ? visits : visits.filter((v) => v.id === scope.visitId);
  const es = scope === 'all' ? ledger : ledger.filter((e) => e.visitId === scope.visitId);
  const twd: CostSummary['twd'] = { passport: 0, ticket: 0, job: 0, other: 0, total: 0 };
  let ticketsUnrecorded = 0;
  let ticketCount = 0;
  let ticketSaved = 0;

  for (const v of vs) {
    const t = ticketTotals(v.tickets);
    if (!t) {
      ticketsUnrecorded += 1;
      continue;
    }
    twd.ticket += t.paid;
    ticketSaved += t.saved;
    ticketCount += t.count;
  }

  let kidzosWage = 0;
  let kidzosDiscount = 0;
  for (const e of es) {
    if (e.currency === 'TWD') {
      twd[twdCategoryOf(e)] += -e.amount;
    } else if (e.passportBonus) {
      if (e.type === 'earn') kidzosWage += e.passportBonus;
      else kidzosDiscount += e.passportBonus;
    }
  }
  for (const k of ['passport', 'ticket', 'job', 'other'] as const) {
    twd[k] = twd[k] === 0 ? 0 : twd[k]; // -0 → 0
  }
  twd.total = twd.passport + twd.ticket + twd.job + twd.other;
  return { twd, visits: vs.length, ticketsUnrecorded, ticketCount, saved: { ticketTwd: ticketSaved, kidzosWage, kidzosDiscount } };
}
