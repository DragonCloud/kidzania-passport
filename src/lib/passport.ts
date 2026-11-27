import type { CitizenPassport, Completion, PassportLevel } from '../types/models';
import { localDateISO } from './format';

/**
 * B·KidZanian 市民護照（資料來源：KidZania Taipei「B·KidZanian 政策」，2026-11-27 讀取）
 * - 辦理費 NT$399／本，沒有年費，不含門票；辦好當天出示護照即有權益
 * - 可用到 18 歲生日前一天；遺失補發 NT$150，等級保留，舊章不轉移
 * - 模範市民 → 用目前等級的護照集滿 30 枚職業館印章後換發 → 傑出市民 → 再 30 枚 → 榮譽市民
 * - 同一個職業每天最多 1 枚章
 */
export const PASSPORT_SOURCE = {
  label: 'KidZania Taipei「B·KidZanian 政策」',
  path: '/tw-zh/bkidzanian-terms',
  readOn: '2026-11-27',
} as const;

export const PASSPORT_FEE = 399;
export const REPLACEMENT_FEE = 150;
export const STAMPS_PER_LEVEL = 30;
export const EXPIRY_REMIND_DAYS = 90;

export const LEVEL_LABEL: Record<PassportLevel, string> = {
  model: '模範市民',
  outstanding: '傑出市民',
  honor: '榮譽市民',
};

export const NEXT_LEVEL: Record<PassportLevel, Exclude<PassportLevel, 'model'> | null> = {
  model: 'outstanding',
  outstanding: 'honor',
  honor: null,
};

export interface Perks {
  /** 指定職業的薪資加碼（kidZos） */
  wage: number;
  /** 要付 kidZos 的體驗少付（kidZos） */
  experience: number;
  /** 購物中心每件商品少付（kidZos） */
  shopPerItem: number;
  /** 禮品中心、相片中心折扣（95 折＝5%） */
  giftPhotoPct: number;
  /** 生日券：餐飲折扣（9 折＝10%） */
  birthdayDiningPct: number;
}

export const PERKS: Record<PassportLevel, Perks> = {
  model: { wage: 2, experience: 2, shopPerItem: 5, giftPhotoPct: 5, birthdayDiningPct: 10 },
  outstanding: { wage: 4, experience: 4, shopPerItem: 10, giftPhotoPct: 10, birthdayDiningPct: 15 },
  honor: { wage: 6, experience: 6, shopPerItem: 15, giftPhotoPct: 15, birthdayDiningPct: 20 },
};

/** 折扣百分比 → 「95 折」 */
export function discountLabel(pct: number): string {
  const n = 100 - pct;
  return `${n % 10 === 0 ? n / 10 : n} 折`;
}

// ───────── 日期工具（'YYYY-MM-DD'，以 UTC 計算避免時區誤差） ─────────

function parse(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? { y: +m[1]!, m: +m[2]!, d: +m[3]! } : null;
}
function fmt(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}
export function addDays(iso: string, days: number): string {
  const p = parse(iso)!;
  return fmt(Date.UTC(p.y, p.m - 1, p.d) + days * 86_400_000);
}
export function daysBetween(fromIso: string, toIso: string): number {
  const a = parse(fromIso)!;
  const b = parse(toIso)!;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** 'YYYY-MM-DD' 的當地 00:00（epoch ms） */
export function localMidnight(iso: string): number {
  const p = parse(iso)!;
  return new Date(p.y, p.m - 1, p.d).getTime();
}

/** 辦理時間：有 issuedAt 用 issuedAt；舊資料只有日期 → 當天 00:00 */
export function issuedAtOf(p: CitizenPassport): number {
  return p.issuedAt ?? localMidnight(p.issuedOn);
}
export function upgradeAtOf(u: CitizenPassport['upgrades'][number]): number {
  return u.at ?? localMidnight(u.date);
}
export function replacementAtOf(r: CitizenPassport['replacements'][number]): number {
  return r.at ?? localMidnight(r.date);
}

// ───────── 效期 ─────────

/**
 * 滿 18 歲那天（與 age.ts 一致：2/29 生日在平年以 3/1 為生日）
 */
export function eighteenthBirthday(birthday: string): string | null {
  const p = parse(birthday);
  if (!p) return null;
  const y = p.y + 18;
  const t = Date.UTC(y, p.m - 1, p.d);
  const ok = new Date(t).getUTCMonth() === p.m - 1;
  return ok ? fmt(t) : fmt(Date.UTC(y, 2, 1)); // 不存在的日期（2/29）→ 3/1
}

/** 護照有效期限：18 歲生日前一天 */
export function passportExpiry(birthday: string | null): string | null {
  if (!birthday) return null;
  const b18 = eighteenthBirthday(birthday);
  return b18 ? addDays(b18, -1) : null;
}

/** 某天護照是否有效（辦理日當天起，到 18 歲生日前一天） */
export function isPassportValidOn(p: CitizenPassport | null | undefined, birthday: string | null, date: string): boolean {
  if (!p || date < p.issuedOn) return false;
  const exp = passportExpiry(birthday);
  return exp === null ? true : date <= exp;
}

/** 某個時間點護照是否有效：辦理時間之後（含），到 18 歲生日前一天 */
export function isPassportValidAt(p: CitizenPassport | null | undefined, birthday: string | null, at: number): boolean {
  if (!p || at < issuedAtOf(p)) return false;
  const exp = passportExpiry(birthday);
  return exp === null ? true : localDateISO(at) <= exp;
}

export type ExpiryState = 'ok' | 'soon' | 'expired' | 'unknown';

export function expiryStatus(birthday: string | null, today: string): { expiry: string | null; daysLeft: number | null; state: ExpiryState } {
  const expiry = passportExpiry(birthday);
  if (!expiry) return { expiry: null, daysLeft: null, state: 'unknown' };
  const daysLeft = daysBetween(today, expiry);
  return { expiry, daysLeft, state: daysLeft < 0 ? 'expired' : daysLeft <= EXPIRY_REMIND_DAYS ? 'soon' : 'ok' };
}

// ───────── 等級 ─────────

function sortedUpgrades(p: CitizenPassport) {
  return [...p.upgrades].sort((a, b) => upgradeAtOf(a) - upgradeAtOf(b));
}

/** 某個時間點的等級（換發時間起適用）；辦理前為 null */
export function levelAt(p: CitizenPassport | null | undefined, at: number): PassportLevel | null {
  if (!p || at < issuedAtOf(p)) return null;
  let level: PassportLevel = 'model';
  for (const u of sortedUpgrades(p)) if (upgradeAtOf(u) <= at) level = u.level;
  return level;
}

/** 這一級集章的起算時間（epoch ms）：辦理、上次升級、最近補發三者最晚者 */
export function progressWindowStartAt(p: CitizenPassport): number {
  const ups = sortedUpgrades(p);
  const starts = [issuedAtOf(p), ...ups.map(upgradeAtOf), ...p.replacements.map(replacementAtOf)];
  return Math.max(...starts);
}

/** 某天的等級（升級當天起適用）；辦理前為 null */
export function levelOn(p: CitizenPassport | null | undefined, date: string): PassportLevel | null {
  if (!p || date < p.issuedOn) return null;
  let level: PassportLevel = 'model';
  for (const u of sortedUpgrades(p)) if (u.date <= date) level = u.level;
  return level;
}

export function currentLevel(p: CitizenPassport): PassportLevel {
  const ups = sortedUpgrades(p);
  return ups.at(-1)?.level ?? 'model';
}

/** 目前等級從哪天開始 */
export function levelSince(p: CitizenPassport): string {
  return sortedUpgrades(p).at(-1)?.date ?? p.issuedOn;
}

/** 這一級的集章從哪天起算：辦理日或上次升級日；遺失補發後舊章不轉移，從補發日重算 */
export function progressWindowStart(p: CitizenPassport): string {
  const starts = [levelSince(p), ...p.replacements.map((r) => r.date)];
  return starts.reduce((a, b) => (b > a ? b : a));
}

// ───────── 印章 ─────────

/** 同一個職業每天最多 1 枚：回傳 (jobId, 日期) 不重複的數量 */
export function countDailyStamps(
  completions: Pick<Completion, 'jobId' | 'completedAt' | 'countsForPassport'>[],
  from: string | number,
  to?: string,
): number {
  const seen = new Set<string>();
  for (const c of completions) {
    const d = localDateISO(c.completedAt);
    if (c.countsForPassport === false) continue; // 手動指定不算
    if (c.countsForPassport !== true) {
      const before = typeof from === 'number' ? c.completedAt < from : d < from;
      if (before || (to && d > to)) continue;
    }
    seen.add(`${c.jobId}@${d}`);
  }
  return seen.size;
}

/**
 * 這個章算不算進目前護照的集章（不考慮每天 1 枚的去重）：
 * 手動指定優先；否則看是否在起算時間之後、效期之內
 */
export function countsTowardPassport(
  c: Pick<Completion, 'completedAt' | 'countsForPassport'>,
  p: CitizenPassport | null | undefined,
  birthday: string | null,
): boolean {
  if (c.countsForPassport !== undefined) return c.countsForPassport;
  if (!p) return false;
  const exp = passportExpiry(birthday);
  return c.completedAt >= progressWindowStartAt(p) && (exp === null || localDateISO(c.completedAt) <= exp);
}

/** 章是在辦護照之前蓋的（印章牆的「辦護照前」標籤） */
export function isBeforePassport(c: Pick<Completion, 'completedAt' | 'countsForPassport'>, p: CitizenPassport | null | undefined): boolean {
  return !!p && c.countsForPassport !== true && c.completedAt < issuedAtOf(p);
}

export interface StampProgress {
  level: PassportLevel;
  nextLevel: Exclude<PassportLevel, 'model'> | null;
  count: number;
  needed: number;
  remaining: number;
  /** 已集滿，可到現場換發 */
  ready: boolean;
  windowStart: string;
  windowStartAt: number;
}

export function stampProgress(
  p: CitizenPassport,
  completions: Pick<Completion, 'jobId' | 'completedAt' | 'countsForPassport'>[],
  birthday: string | null,
): StampProgress {
  const level = currentLevel(p);
  const nextLevel = NEXT_LEVEL[level];
  const windowStartAt = progressWindowStartAt(p);
  const windowStart = localDateISO(windowStartAt);
  const count = countDailyStamps(completions, windowStartAt, passportExpiry(birthday) ?? undefined);
  const remaining = Math.max(0, STAMPS_PER_LEVEL - count);
  return { level, nextLevel, count, needed: STAMPS_PER_LEVEL, remaining, ready: nextLevel !== null && remaining === 0, windowStart, windowStartAt };
}

// ───────── 權益計算 ─────────

/**
 * 職業的 kidZos 套用護照權益：
 * - 賺（delta > 0）：加 wage
 * - 付（delta < 0）：少付 experience，最多少付到 0
 * 回傳實際金額與權益效果（正數）
 */
export function applyJobPerk(delta: number, level: PassportLevel): { amount: number; bonus: number } {
  const perk = PERKS[level];
  if (delta > 0) return { amount: delta + perk.wage, bonus: perk.wage };
  if (delta < 0) {
    const cut = Math.min(perk.experience, -delta);
    return { amount: delta + cut, bonus: cut };
  }
  return { amount: 0, bonus: 0 };
}

/** 購物中心：每件少付 shopPerItem，最多少付到 0 */
export function applyShopPerk(listTotal: number, items: number, level: PassportLevel): { amount: number; bonus: number } {
  const cut = Math.min(PERKS[level].shopPerItem * Math.max(0, items), Math.max(0, listTotal));
  const amount = cut - listTotal;
  return { amount: amount === 0 ? 0 : amount, bonus: cut };
}

export function perkNote(level: PassportLevel, kind: 'wage' | 'experience' | 'shop', bonus: number, items = 1): string {
  const name = LEVEL_LABEL[level];
  if (kind === 'wage') return `${name}加碼 +${bonus}`;
  if (kind === 'experience') return `${name}減免 ${bonus}`;
  return `${name}減免 ${PERKS[level].shopPerItem}×${items}`;
}

/** 自動帳的備註：「動物醫師」或「動物醫師（模範市民加碼 +2）」 */
export function autoKidzosNote(jobName: string, level: PassportLevel | null, base: number, bonus: number): string {
  return bonus && level ? `${jobName}（${perkNote(level, base > 0 ? 'wage' : 'experience', bonus)}）` : jobName;
}

/** 今天的 'YYYY-MM-DD'（給沒有 completedAt 的情境） */
export function isoOf(ms: number): string {
  return localDateISO(ms);
}
