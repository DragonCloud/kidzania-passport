import { db, type AppDB } from '../db/db';
import type { ChildProfile, CitizenPassport, LedgerEntry, PassportLevel, TicketTypeId, VisitTicket } from '../types/models';
import { todayISO } from './age';
import { getChild } from './child';
import { localDateISO } from './format';
import {
  currentLevel,
  issuedAtOf,
  LEVEL_LABEL,
  localMidnight,
  NEXT_LEVEL,
  PASSPORT_FEE,
  REPLACEMENT_FEE,
  replacementAtOf,
  upgradeAtOf,
} from './passport';
import { recalcPassportEntries } from './passportRecalc';
import { DEFAULT_TICKET_PRICES, normalizeTickets } from './tickets';
import { dateStartMs } from './visits';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function checkDate(iso: string, what: string) {
  if (!ISO.test(iso) || Number.isNaN(dateStartMs(iso))) throw new Error(`${what}格式不正確`);
}
function checkFee(fee: number) {
  if (!Number.isFinite(fee) || fee < 0) throw new Error('費用需為 0 以上');
}
function checkAt(at: number, what: string) {
  if (!Number.isFinite(at)) throw new Error(`${what}格式不正確`);
}

/** 只給日期時的預設時間：今天 → 現在；其他日子 → 當天 00:00 */
function defaultAt(date: string): number {
  return date === todayISO() ? Date.now() : localMidnight(date);
}

/** 固定 id（兩支手機同時建立也只有一筆）；刪除過的 id 不能在雲端復活，改用 -2、-3… */
function stableId(child: ChildProfile, base: string): string {
  const retired = new Set(child.retiredPassportEntryIds ?? []);
  if (!retired.has(base)) return base;
  let n = 2;
  while (retired.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
function retire(child: ChildProfile, id: string | undefined) {
  if (!id) return;
  child.retiredPassportEntryIds = [...new Set([...(child.retiredPassportEntryIds ?? []), id])];
}

/** 一次性費用：不屬於任何入園，記在辦理時間 */
function feeEntry(id: string, at: number, fee: number, note: string): LedgerEntry {
  return { id, at, type: 'twd_fee', amount: -Math.round(fee), currency: 'TWD', twdCategory: 'passport', note };
}

const tables = (d: AppDB) => [d.child, d.ledger, d.outbox, d.completions];

/**
 * 在交易內修改孩子資料（含護照），寫回後重算所有蓋章自動帳。
 */
async function withChild<T>(d: AppDB, fn: (child: ChildProfile) => Promise<T> | T): Promise<T> {
  return d.transaction('rw', tables(d), async () => {
    const child = structuredClone(await getChild(d));
    const out = await fn(child);
    await d.child.put({ ...child, id: 'kid' });
    await recalcPassportEntries(d);
    return out;
  });
}

export interface PassportInput {
  issuedOn: string;
  /** 辦理時間（epoch ms）；有給時 issuedOn 以它的當地日期為準 */
  issuedAt?: number;
  fee?: number;
  /** 建立時已經是較高等級（例如之前就換發過）：給等級與換發日 */
  level?: PassportLevel;
  levelSince?: string;
  levelSinceAt?: number;
}

/** 建立或修改市民護照；辦理費同步記一筆新臺幣支出（護照費，固定 id） */
export function savePassport(input: PassportInput, d: AppDB = db): Promise<CitizenPassport> {
  if (input.issuedAt !== undefined) checkAt(input.issuedAt, '辦理時間');
  const issuedOn = input.issuedAt !== undefined ? localDateISO(input.issuedAt) : input.issuedOn;
  checkDate(issuedOn, '辦理日期');
  const fee = input.fee ?? PASSPORT_FEE;
  checkFee(fee);
  return withChild(d, async (child) => {
    const prev = child.passport ?? null;
    const issuedAt = input.issuedAt ?? (prev && prev.issuedOn === issuedOn ? prev.issuedAt : defaultAt(issuedOn));
    const next: CitizenPassport = prev ? { ...prev, issuedOn, fee } : { issuedOn, fee, upgrades: [], replacements: [] };
    if (issuedAt === undefined) delete next.issuedAt;
    else next.issuedAt = issuedAt;
    if (!prev && input.level && input.level !== 'model') {
      const date = input.levelSinceAt !== undefined ? localDateISO(input.levelSinceAt) : (input.levelSince ?? issuedOn);
      checkDate(date, '換發日期');
      const at = input.levelSinceAt ?? (date === issuedOn && issuedAt !== undefined ? issuedAt : localMidnight(date));
      next.upgrades =
        input.level === 'honor'
          ? [
              { level: 'outstanding', date, at },
              { level: 'honor', date, at },
            ]
          : [{ level: 'outstanding', date, at }];
    }
    const start = issuedAtOf(next);
    if (next.upgrades.some((u) => upgradeAtOf(u) < start)) throw new Error('換發時間不可早於辦理時間');

    // 辦理費：沿用既有那筆（含舊版隨機 id）；沒有才用固定 id
    if (fee > 0) {
      const id = prev?.feeEntryId ?? stableId(child, 'passport-fee');
      await d.ledger.put(feeEntry(id, start, fee, 'B·KidZanian 市民護照辦理費'));
      next.feeEntryId = id;
    } else if (prev?.feeEntryId) {
      await d.ledger.delete(prev.feeEntryId);
      retire(child, prev.feeEntryId);
      delete next.feeEntryId;
    }
    child.passport = next;
    return next;
  });
}

/** 舊護照（沒有 issuedAt）補上辦理時間：辦理前的章不算、也不加碼 */
export function setPassportIssuedAt(at: number, d: AppDB = db): Promise<CitizenPassport> {
  checkAt(at, '辦理時間');
  return withChild(d, async (child) => {
    const p = child.passport;
    if (!p) throw new Error('還沒有市民護照');
    const next: CitizenPassport = { ...p, issuedAt: at, issuedOn: localDateISO(at) };
    const firstUp = next.upgrades.map(upgradeAtOf).sort((a, b) => a - b)[0];
    if (firstUp !== undefined && firstUp < at) throw new Error('辦理時間不可晚於升級時間');
    if (p.feeEntryId) {
      const fee = await d.ledger.get(p.feeEntryId);
      if (fee) await d.ledger.put({ ...fee, at });
    }
    child.passport = next;
    return next;
  });
}

/** 移除護照紀錄（連同辦理費、補發費的支出）；所有加碼帳回到表定值 */
export async function removePassport(d: AppDB = db): Promise<void> {
  await withChild(d, async (child) => {
    const p = child.passport;
    if (!p) return;
    const ids = [p.feeEntryId, ...p.replacements.map((r) => r.entryId)].filter((x): x is string => !!x);
    if (ids.length) await d.ledger.bulkDelete(ids);
    ids.forEach((id) => retire(child, id));
    child.passport = null;
  });
}

function mutate(d: AppDB, fn: (p: CitizenPassport, child: ChildProfile) => Promise<CitizenPassport> | CitizenPassport): Promise<CitizenPassport> {
  return withChild(d, async (child) => {
    if (!child.passport) throw new Error('還沒有市民護照');
    child.passport = await fn(child.passport, child);
    return child.passport;
  });
}

/** 到現場換發後，手動記錄升級（換發時間起適用新等級的權益） */
export function recordUpgrade(date: string, d: AppDB = db, atInput?: number): Promise<CitizenPassport> {
  const day = atInput !== undefined ? localDateISO(atInput) : date;
  checkDate(day, '換發日期');
  const at = atInput ?? defaultAt(day);
  return mutate(d, (p) => {
    const next = NEXT_LEVEL[currentLevel(p)];
    if (!next) throw new Error('已經是最高等級（榮譽市民）');
    const lastAt = Math.max(issuedAtOf(p), ...p.upgrades.map(upgradeAtOf));
    const last = p.upgrades.at(-1)?.date ?? p.issuedOn;
    if (at < lastAt) throw new Error(`換發日期不可早於 ${last}`);
    // 只有日期（不是今天）時不存 at：讀取時視為當天 00:00，與舊資料一致
    p.upgrades.push(atInput !== undefined || day === todayISO() ? { level: next, date: day, at } : { level: next, date: day });
    return p;
  });
}

/** 取消最近一次升級（記錯時用） */
export function undoUpgrade(d: AppDB = db): Promise<CitizenPassport> {
  return mutate(d, (p) => {
    const sorted = [...p.upgrades].sort((a, b) => upgradeAtOf(a) - upgradeAtOf(b));
    sorted.pop();
    p.upgrades = sorted;
    return p;
  });
}

/** 遺失補發：等級保留，舊章不轉移（集章從補發時間重算）；補發費記一筆護照費（固定 id） */
export function addReplacement(input: { date: string; fee?: number; at?: number }, d: AppDB = db): Promise<CitizenPassport> {
  const date = input.at !== undefined ? localDateISO(input.at) : input.date;
  checkDate(date, '補發日期');
  const fee = input.fee ?? REPLACEMENT_FEE;
  checkFee(fee);
  const at = input.at ?? defaultAt(date);
  return mutate(d, async (p, child) => {
    if (at < issuedAtOf(p)) throw new Error('補發日期不可早於辦理日期');
    if (p.replacements.some((r) => r.date === date)) throw new Error('這天已經記錄過補發');
    let entryId: string | undefined;
    if (fee > 0) {
      entryId = stableId(child, `passport-replacement-${date}`);
      await d.ledger.put(feeEntry(entryId, at, fee, `市民護照遺失補發（${LEVEL_LABEL[currentLevel(p)]}）`));
    }
    const withAt = input.at !== undefined || date === todayISO();
    p.replacements.push({ date, fee, ...(withAt ? { at } : {}), ...(entryId ? { entryId } : {}) });
    p.replacements.sort((a, b) => replacementAtOf(a) - replacementAtOf(b));
    return p;
  });
}

export function removeReplacement(index: number, d: AppDB = db): Promise<CitizenPassport> {
  return mutate(d, async (p, child) => {
    const [r] = p.replacements.splice(index, 1);
    if (r?.entryId) {
      await d.ledger.delete(r.entryId);
      retire(child, r.entryId);
    }
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
