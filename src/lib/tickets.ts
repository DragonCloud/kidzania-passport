import type { ChildProfile, TicketPriceTable, TicketTypeId, VisitTicket } from '../types/models';

/**
 * 門票（資料來源：KidZania Taipei「購票政策」，2026-11-27 讀取）
 * 官方沒有會員價，持市民護照不打折。平日、假日、場次如有不同價格，以訂票系統為準。
 */
export const TICKET_SOURCE = {
  label: 'KidZania Taipei「購票政策」',
  path: '/tw-zh/ticketing-policy',
  readOn: '2026-11-27',
} as const;

export const TICKET_TYPES: { id: TicketTypeId; label: string; hint: string }[] = [
  { id: 'child', label: '孩童／學生', hint: '3–17 歲' },
  { id: 'adult', label: '成人陪同', hint: '18–64 歲' },
  { id: 'senior', label: '敬老陪同', hint: '65 歲以上' },
  { id: 'careChild', label: '愛心孩童', hint: '' },
  { id: 'careAdult', label: '愛心成人陪同', hint: '' },
  { id: 'infant', label: '幼兒', hint: '0–2 歲' },
];

export const DEFAULT_TICKET_PRICES: Record<TicketTypeId, number> = {
  child: 1400,
  adult: 700,
  senior: 350,
  careChild: 700,
  careAdult: 350,
  infant: 0,
};

export function ticketTypeLabel(id: TicketTypeId): string {
  return TICKET_TYPES.find((t) => t.id === id)?.label ?? id;
}

/** 使用者自訂的價格表（缺的票種用官方預設） */
export function ticketPricesOf(child: Pick<ChildProfile, 'ticketPrices'> | null | undefined): TicketPriceTable {
  return {
    prices: { ...DEFAULT_TICKET_PRICES, ...(child?.ticketPrices?.prices ?? {}) },
    updatedOn: child?.ticketPrices?.updatedOn,
  };
}

export function isDefaultPrices(t: TicketPriceTable): boolean {
  return (Object.keys(DEFAULT_TICKET_PRICES) as TicketTypeId[]).every((k) => t.prices[k] === DEFAULT_TICKET_PRICES[k]);
}

export interface TicketTotals {
  count: number;
  /** 原價合計 */
  list: number;
  /** 實付合計 */
  paid: number;
  /** 省下（原價−實付；通常為 0） */
  saved: number;
}

export function ticketTotals(tickets: VisitTicket[] | undefined): TicketTotals | null {
  if (!tickets) return null; // 未記錄
  const t = { count: 0, list: 0, paid: 0, saved: 0 };
  for (const x of tickets) {
    const q = Math.max(0, Math.floor(x.qty));
    t.count += q;
    t.list += q * x.listPrice;
    t.paid += q * x.paidPrice;
  }
  t.saved = t.list - t.paid;
  return t;
}

/** 驗證並整理使用者輸入的門票 */
export function normalizeTickets(lines: VisitTicket[]): VisitTicket[] {
  return lines
    .map((l) => ({
      ...l,
      label: l.label.trim() || (l.type === 'custom' ? '自訂票' : ticketTypeLabel(l.type)),
      qty: Math.max(0, Math.floor(Number(l.qty) || 0)),
      listPrice: Math.max(0, Math.round(Number(l.listPrice) || 0)),
      paidPrice: Math.max(0, Math.round(Number(l.paidPrice) || 0)),
      note: l.note?.trim() || undefined,
    }))
    .filter((l) => l.qty > 0);
}
