import { db, newId, type AppDB } from '../db/db';
import type { CitizenPassport, LedgerEntry, PassportLevel, TicketTypeId, VisitTicket } from '../types/models';
import { getChild } from './child';
import { currentLevel, LEVEL_LABEL, NEXT_LEVEL, PASSPORT_FEE, REPLACEMENT_FEE } from './passport';
import { DEFAULT_TICKET_PRICES, normalizeTickets } from './tickets';
import { dateStartMs } from './visits';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function checkDate(iso: string, what: string) {
  if (!ISO.test(iso) || Number.isNaN(dateStartMs(iso))) throw new Error(`${what}格式不正確`);
}
function checkFee(fee: number) {
  if (!Number.isFinite(fee) || fee < 0) throw new Error('費用需為 0 以上');
}

/** 一次性費用：不屬於任何入園，記在當天中午（避免時區邊界） */
function feeEntry(id: string, date: string, fee: number, note: string): LedgerEntry {
  return {
    id,
    at: dateStartMs(date) + 12 * 3_600_000,
    type: 'twd_fee',
    amount: -Math.round(fee),
    currency: 'TWD',
    twdCategory: 'passport',
    note,
  };
}

const tables = (d: AppDB) => [d.child, d.ledger, d.outbox];

async function putFee(d: AppDB, entryId: string | undefined, date: string, fee: number, note: string): Promise<string | undefined> {
  if (fee <= 0) {
    if (entryId) await d.ledger.delete(entryId);
    return undefined;
  }
  const id = entryId ?? newId();
  await d.ledger.put(feeEntry(id, date, fee, note));
  return id;
}

export interface PassportInput {
  issuedOn: string;
  fee?: number;
  /** 建立時已經是較高等級（例如之前就換發過）：給等級與換發日 */
  level?: PassportLevel;
  levelSince?: string;
}

/** 建立或修改市民護照；辦理費同步記一筆新臺幣支出（護照費） */
export async function savePassport(input: PassportInput, d: AppDB = db): Promise<CitizenPassport> {
  checkDate(input.issuedOn, '辦理日期');
  const fee = input.fee ?? PASSPORT_FEE;
  checkFee(fee);
  let saved!: CitizenPassport;
  await d.transaction('rw', tables(d), async () => {
    const child = await getChild(d);
    const prev = child.passport ?? null;
    const next: CitizenPassport = prev
      ? { ...prev, issuedOn: input.issuedOn, fee }
      : { issuedOn: input.issuedOn, fee, upgrades: [], replacements: [] };
    if (!prev && input.level && input.level !== 'model') {
      const since = input.levelSince ?? input.issuedOn;
      checkDate(since, '換發日期');
      next.upgrades =
        input.level === 'honor'
          ? [
              { level: 'outstanding', date: since },
              { level: 'honor', date: since },
            ]
          : [{ level: 'outstanding', date: since }];
    }
    if (next.upgrades.some((u) => u.date < next.issuedOn)) throw new Error('換發日期不可早於辦理日期');
    next.feeEntryId = await putFee(d, prev?.feeEntryId, next.issuedOn, fee, 'B·KidZanian 市民護照辦理費');
    if (!next.feeEntryId) delete next.feeEntryId;
    await d.child.put({ ...child, id: 'kid', passport: next });
    saved = next;
  });
  return saved;
}

/** 移除護照紀錄（連同辦理費、補發費的支出） */
export async function removePassport(d: AppDB = db): Promise<void> {
  await d.transaction('rw', tables(d), async () => {
    const child = await getChild(d);
    const p = child.passport;
    if (!p) return;
    const ids = [p.feeEntryId, ...p.replacements.map((r) => r.entryId)].filter((x): x is string => !!x);
    if (ids.length) await d.ledger.bulkDelete(ids);
    await d.child.put({ ...child, id: 'kid', passport: null });
  });
}

async function mutate(d: AppDB, fn: (p: CitizenPassport) => Promise<CitizenPassport> | CitizenPassport): Promise<CitizenPassport> {
  let saved!: CitizenPassport;
  await d.transaction('rw', tables(d), async () => {
    const child = await getChild(d);
    if (!child.passport) throw new Error('還沒有市民護照');
    saved = await fn(structuredClone(child.passport));
    await d.child.put({ ...child, id: 'kid', passport: saved });
  });
  return saved;
}

/** 到現場換發後，手動記錄升級（升級當天起適用新等級的權益） */
export function recordUpgrade(date: string, d: AppDB = db): Promise<CitizenPassport> {
  checkDate(date, '換發日期');
  return mutate(d, (p) => {
    const next = NEXT_LEVEL[currentLevel(p)];
    if (!next) throw new Error('已經是最高等級（榮譽市民）');
    const last = p.upgrades.at(-1)?.date ?? p.issuedOn;
    if (date < last) throw new Error(`換發日期不可早於 ${last}`);
    p.upgrades.push({ level: next, date });
    return p;
  });
}

/** 取消最近一次升級（記錯時用） */
export function undoUpgrade(d: AppDB = db): Promise<CitizenPassport> {
  return mutate(d, (p) => {
    p.upgrades.pop();
    return p;
  });
}

/** 遺失補發：等級保留，舊章不轉移（集章從補發日重算）；補發費記一筆護照費 */
export function addReplacement(input: { date: string; fee?: number }, d: AppDB = db): Promise<CitizenPassport> {
  checkDate(input.date, '補發日期');
  const fee = input.fee ?? REPLACEMENT_FEE;
  checkFee(fee);
  return mutate(d, async (p) => {
    if (input.date < p.issuedOn) throw new Error('補發日期不可早於辦理日期');
    const entryId = await putFee(d, undefined, input.date, fee, `市民護照遺失補發（${LEVEL_LABEL[currentLevel(p)]}）`);
    p.replacements.push({ date: input.date, fee, ...(entryId ? { entryId } : {}) });
    p.replacements.sort((a, b) => (a.date < b.date ? -1 : 1));
    return p;
  });
}

export function removeReplacement(index: number, d: AppDB = db): Promise<CitizenPassport> {
  return mutate(d, async (p) => {
    const [r] = p.replacements.splice(index, 1);
    if (r?.entryId) await d.ledger.delete(r.entryId);
    return p;
  });
}

// ───────── 門票價格表 ─────────

export async function saveTicketPrices(prices: Partial<Record<TicketTypeId, number>>, updatedOn: string, d: AppDB = db): Promise<void> {
  const clean = { ...DEFAULT_TICKET_PRICES };
  for (const k of Object.keys(clean) as TicketTypeId[]) {
    const v = prices[k];
    if (v !== undefined) {
      if (!Number.isFinite(v) || v < 0) throw new Error('票價需為 0 以上');
      clean[k] = Math.round(v);
    }
  }
  await d.transaction('rw', [d.child, d.outbox], async () => {
    const child = await getChild(d);
    await d.child.put({ ...child, id: 'kid', ticketPrices: { prices: clean, updatedOn } });
  });
}

/** 恢復官方預設價格 */
export async function resetTicketPrices(d: AppDB = db): Promise<void> {
  await d.transaction('rw', [d.child, d.outbox], async () => {
    const child = await getChild(d);
    const next = { ...child, id: 'kid' as const };
    delete next.ticketPrices;
    await d.child.put(next);
  });
}

// ───────── 入園門票 ─────────

/** 記錄這次入園的門票；null＝改回「未記錄」，[]＝記錄為沒有買票（例如全部免費） */
export async function saveVisitTickets(visitId: string, tickets: VisitTicket[] | null, d: AppDB = db): Promise<void> {
  await d.transaction('rw', [d.visits, d.outbox], async () => {
    const v = await d.visits.get(visitId);
    if (!v) throw new Error('找不到這次入園紀錄');
    const next = { ...v };
    if (tickets === null) delete next.tickets;
    else next.tickets = normalizeTickets(tickets);
    await d.visits.put(next);
  });
}
