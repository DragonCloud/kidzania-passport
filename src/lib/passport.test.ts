import 'fake-indexeddb/auto';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { AppDB } from '../db/db';
import type { CitizenPassport, LedgerEntry, Visit } from '../types/models';
import { exportBackup, importBackup } from './backup';
import { saveChild } from './child';
import { addCompletion } from './completions';
import { summarizeCosts, twdCategoryOf } from './costs';
import { addManualEntry, autoEntriesForJob } from './ledger';
import {
  applyJobPerk,
  applyShopPerk,
  countDailyStamps,
  currentLevel,
  discountLabel,
  expiryStatus,
  isPassportValidOn,
  levelOn,
  passportExpiry,
  progressWindowStart,
  stampProgress,
} from './passport';
import { addReplacement, recordUpgrade, removePassport, resetTicketPrices, saveTicketPrices, savePassport, saveVisitTickets, undoUpgrade } from './passportStore';
import { DEFAULT_TICKET_PRICES, normalizeTickets, ticketPricesOf, ticketTotals } from './tickets';
import { createVisit, dateStartMs } from './visits';

// 假資料：孩子「小明」，生日 2020-03-15
const BDAY = '2020-03-15';
const at = (iso: string, h = 10) => dateStartMs(iso) + h * 3_600_000;
const pp = (over: Partial<CitizenPassport> = {}): CitizenPassport => ({ issuedOn: '2026-01-10', fee: 399, upgrades: [], replacements: [], ...over });

let n = 0;
const dbs: AppDB[] = [];
function fresh() {
  const d = new AppDB(`passport-test-${++n}`);
  dbs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dbs.splice(0)) await d.delete();
});

describe('護照效期', () => {
  it('18 歲生日前一天到期；辦理日當天起有效', () => {
    expect(passportExpiry(BDAY)).toBe('2038-03-14');
    expect(passportExpiry(null)).toBeNull();
    const p = pp();
    expect(isPassportValidOn(p, BDAY, '2026-01-09')).toBe(false);
    expect(isPassportValidOn(p, BDAY, '2026-01-10')).toBe(true);
    expect(isPassportValidOn(p, BDAY, '2038-03-14')).toBe(true);
    expect(isPassportValidOn(p, BDAY, '2038-03-15')).toBe(false);
    expect(isPassportValidOn(null, BDAY, '2027-01-01')).toBe(false);
    // 沒填生日：無法算期限，辦理後都視為有效
    expect(isPassportValidOn(p, null, '2040-01-01')).toBe(true);
  });

  it('2/29 生日：18 歲那年是平年 → 3/1 滿 18，2/28 到期；是閏年 → 2/28 到期', () => {
    expect(passportExpiry('2020-02-29')).toBe('2038-02-28'); // 2038 平年，滿 18 在 3/1
    expect(passportExpiry('2008-02-29')).toBe('2026-02-28'); // 2026 平年
    expect(passportExpiry('2014-02-28')).toBe('2032-02-27'); // 2032 閏年，2/28 生日照常
    expect(passportExpiry('2016-03-01')).toBe('2034-02-28');
    expect(passportExpiry('2020-01-01')).toBe('2037-12-31');
  });

  it('最後 90 天提醒', () => {
    expect(expiryStatus(BDAY, '2037-12-13').state).toBe('ok');
    const soon = expiryStatus(BDAY, '2037-12-14');
    expect(soon).toMatchObject({ state: 'soon', daysLeft: 90, expiry: '2038-03-14' });
    expect(expiryStatus(BDAY, '2038-03-14')).toMatchObject({ state: 'soon', daysLeft: 0 });
    expect(expiryStatus(BDAY, '2038-03-15').state).toBe('expired');
    expect(expiryStatus(null, '2026-11-27').state).toBe('unknown');
  });
});

describe('等級與集章', () => {
  const ups = pp({
    upgrades: [
      { level: 'outstanding', date: '2026-08-01' },
      { level: 'honor', date: '2027-05-01' },
    ],
  });

  it('升級當天起適用新等級', () => {
    expect(levelOn(ups, '2026-01-09')).toBeNull();
    expect(levelOn(ups, '2026-07-31')).toBe('model');
    expect(levelOn(ups, '2026-08-01')).toBe('outstanding');
    expect(levelOn(ups, '2027-05-01')).toBe('honor');
    expect(currentLevel(ups)).toBe('honor');
    expect(currentLevel(pp())).toBe('model');
  });

  it('同一職業每天最多 1 枚；不同天或不同職業各算 1 枚', () => {
    const cs = [
      { jobId: 'job-vet', completedAt: at('2026-02-01', 10) },
      { jobId: 'job-vet', completedAt: at('2026-02-01', 15) }, // 同天同職業 → 不算
      { jobId: 'job-vet', completedAt: at('2026-02-02') },
      { jobId: 'job-baseball', completedAt: at('2026-02-01') },
      { jobId: 'job-baseball', completedAt: at('2025-12-31') }, // 辦理前
    ];
    expect(countDailyStamps(cs, '2026-01-10')).toBe(3);
  });

  it('從辦理日或上次升級日起算；遺失補發後舊章不轉移', () => {
    expect(progressWindowStart(pp())).toBe('2026-01-10');
    const up = pp({ upgrades: [{ level: 'outstanding', date: '2026-08-01' }] });
    expect(progressWindowStart(up)).toBe('2026-08-01');
    const lost = pp({ upgrades: [{ level: 'outstanding', date: '2026-08-01' }], replacements: [{ date: '2026-10-01', fee: 150 }] });
    expect(progressWindowStart(lost)).toBe('2026-10-01');

    const cs = Array.from({ length: 31 }, (_, i) => ({ jobId: `job-${i}`, completedAt: at('2026-09-15') }));
    expect(stampProgress(up, cs, BDAY)).toMatchObject({ level: 'outstanding', nextLevel: 'honor', count: 31, remaining: 0, ready: true });
    expect(stampProgress(lost, cs, BDAY)).toMatchObject({ count: 0, remaining: 30, ready: false });
    const p29 = stampProgress(pp(), cs.slice(0, 29), BDAY);
    expect(p29).toMatchObject({ level: 'model', nextLevel: 'outstanding', remaining: 1, ready: false });
    expect(stampProgress(ups, cs, BDAY)).toMatchObject({ nextLevel: null, ready: false });
  });
});

describe('權益加碼與減免', () => {
  it('賺：加 2／4／6；付：少 2／4／6，最多少到 0', () => {
    expect(applyJobPerk(10, 'model')).toEqual({ amount: 12, bonus: 2 });
    expect(applyJobPerk(10, 'outstanding')).toEqual({ amount: 14, bonus: 4 });
    expect(applyJobPerk(10, 'honor')).toEqual({ amount: 16, bonus: 6 });
    expect(applyJobPerk(-10, 'model')).toEqual({ amount: -8, bonus: 2 });
    expect(applyJobPerk(-10, 'honor')).toEqual({ amount: -4, bonus: 6 });
    expect(applyJobPerk(-5, 'honor')).toEqual({ amount: 0, bonus: 5 });
  });

  it('購物中心每件少 5／10／15，最多少到 0；折扣文字', () => {
    expect(applyShopPerk(60, 2, 'model')).toEqual({ amount: -50, bonus: 10 });
    expect(applyShopPerk(60, 2, 'honor')).toEqual({ amount: -30, bonus: 30 });
    expect(applyShopPerk(20, 3, 'honor')).toEqual({ amount: 0, bonus: 20 });
    expect(discountLabel(5)).toBe('95 折');
    expect(discountLabel(10)).toBe('9 折');
    expect(discountLabel(15)).toBe('85 折');
    expect(discountLabel(20)).toBe('8 折');
  });

  it('自動帳：備註寫明加碼，passportBonus 記下效果；新臺幣自費歸類為職業自費', () => {
    const job = { id: 'job-vet', nameZh: '動物醫師', kidzoDelta: 10, ntdFee: null };
    const [e] = autoEntriesForJob(job, { completionId: 'c1', at: 1 }, { perkLevel: 'model' });
    expect(e).toMatchObject({ amount: 12, passportBonus: 2, note: '動物醫師（模範市民加碼 +2）' });
    const [s] = autoEntriesForJob({ ...job, nameZh: '棒球選手', kidzoDelta: -5 }, { completionId: 'c2', at: 1 }, { perkLevel: 'outstanding' });
    expect(s).toMatchObject({ type: 'spend', amount: -1, passportBonus: 4, note: '棒球選手（傑出市民減免 4）' });
    const [plain] = autoEntriesForJob(job, { completionId: 'c3', at: 1 });
    expect(plain!.amount).toBe(10);
    expect(plain!.passportBonus).toBeUndefined();
    const [fee] = autoEntriesForJob({ id: 'job-yakiniku', nameZh: '燒肉職人', kidzoDelta: null, ntdFee: 199 }, { completionId: 'c4', at: 1 });
    expect(fee).toMatchObject({ currency: 'TWD', amount: -199, twdCategory: 'job' });
  });

  it('蓋章：護照在蓋章當天有效才套用，等級依當天', async () => {
    const d = fresh();
    await saveChild({ name: '小明', birthday: BDAY }, d);
    await savePassport({ issuedOn: '2026-06-01' }, d);
    await recordUpgrade('2026-09-01', d);
    const v = await createVisit({ visitDate: '2026-05-20' }, d);
    const before = await addCompletion({ jobId: 'job-vet', visitId: v.id, completedAt: at('2026-05-20'), applyPassportPerk: true }, d);
    expect(before.entries[0]!.amount).toBe(10); // 辦理前
    const model = await addCompletion({ jobId: 'job-vet', completedAt: at('2026-07-01'), applyPassportPerk: true }, d);
    expect(model.entries[0]!.amount).toBe(12);
    const out = await addCompletion({ jobId: 'job-vet', completedAt: at('2026-09-01'), applyPassportPerk: true }, d);
    expect(out.entries[0]!.amount).toBe(14);
    const off = await addCompletion({ jobId: 'job-vet', completedAt: at('2026-09-02'), applyPassportPerk: false }, d);
    expect(off.entries[0]!.amount).toBe(10);
    await saveChild({ birthday: '2008-03-15' }, d); // 已滿 18 → 護照到期
    const expired = await addCompletion({ jobId: 'job-vet', completedAt: at('2026-09-03'), applyPassportPerk: true }, d);
    expect(expired.entries[0]!.amount).toBe(10);
  });
});

describe('門票', () => {
  it('官方預設價格、自訂覆蓋、合計與省下', () => {
    expect(DEFAULT_TICKET_PRICES).toEqual({ child: 1400, adult: 700, senior: 350, careChild: 700, careAdult: 350, infant: 0 });
    expect(ticketPricesOf({ ticketPrices: { prices: { ...DEFAULT_TICKET_PRICES, child: 1500 } } }).prices.child).toBe(1500);
    expect(ticketPricesOf(null).prices.adult).toBe(700);
    expect(ticketTotals(undefined)).toBeNull();
    expect(ticketTotals([])).toEqual({ count: 0, list: 0, paid: 0, saved: 0 });
    const t = ticketTotals([
      { type: 'child', label: '孩童／學生', qty: 1, listPrice: 1400, paidPrice: 1400 },
      { type: 'adult', label: '成人陪同', qty: 2, listPrice: 700, paidPrice: 700 },
      { type: 'custom', label: '信用卡優惠', qty: 1, listPrice: 1400, paidPrice: 1120 },
    ]);
    expect(t).toEqual({ count: 4, list: 4200, paid: 3920, saved: 280 });
    const norm = normalizeTickets([
      { type: 'custom', label: '  ', qty: 1.7, listPrice: -5, paidPrice: 99.6 },
      { type: 'adult', label: '', qty: 0, listPrice: 700, paidPrice: 700 },
    ]);
    expect(norm).toEqual([{ type: 'custom', label: '自訂票', qty: 1, listPrice: 0, paidPrice: 100, note: undefined }]);
  });
});

describe('費用分類與總覽', () => {
  it('舊資料推定：沒有 twdCategory → 有 jobId 是職業自費，否則其他', () => {
    expect(twdCategoryOf({ jobId: 'job-yakiniku' })).toBe('job');
    expect(twdCategoryOf({})).toBe('other');
    expect(twdCategoryOf({ twdCategory: 'ticket', jobId: 'x' })).toBe('ticket');
  });

  it('單次與累計；未記錄門票不算 0；省下金額分開列；kidZos 不換算新臺幣', () => {
    const visits: Visit[] = [
      { id: 'v1', visitDate: '2026-11-01', startingKidzos: 50, createdAt: 1, tickets: [{ type: 'custom', label: '團體票', qty: 2, listPrice: 1400, paidPrice: 1200 }] },
      { id: 'v2', visitDate: '2026-11-20', startingKidzos: 50, createdAt: 2 }, // 舊資料：未記錄
    ];
    const e = (over: Partial<LedgerEntry>): LedgerEntry => ({ id: Math.random().toString(), at: 1, type: 'twd_fee', amount: -1, currency: 'TWD', ...over });
    const ledger: LedgerEntry[] = [
      e({ amount: -399, twdCategory: 'passport' }),
      e({ visitId: 'v1', amount: -199, jobId: 'job-yakiniku' }), // 舊資料 → job
      e({ visitId: 'v2', amount: -80 }), // 舊資料 → other
      e({ visitId: 'v2', amount: -150, twdCategory: 'ticket' }), // 手動記的門票
      e({ visitId: 'v1', type: 'earn', currency: 'kidZos', amount: 12, passportBonus: 2 }),
      e({ visitId: 'v2', type: 'spend', currency: 'kidZos', amount: -6, passportBonus: 4 }),
      e({ visitId: 'v2', type: 'purchase', currency: 'kidZos', amount: -50, passportBonus: 10 }),
    ];
    const all = summarizeCosts(visits, ledger, 'all');
    expect(all.twd).toEqual({ passport: 399, ticket: 2400 + 150, job: 199, other: 80, total: 399 + 2550 + 199 + 80 });
    expect(all).toMatchObject({ visits: 2, ticketsUnrecorded: 1, ticketCount: 2 });
    expect(all.saved).toEqual({ ticketTwd: 400, kidzosWage: 2, kidzosDiscount: 14 });

    const v1 = summarizeCosts(visits, ledger, { visitId: 'v1' });
    expect(v1.twd).toEqual({ passport: 0, ticket: 2400, job: 199, other: 0, total: 2599 });
    expect(v1.ticketsUnrecorded).toBe(0);
    const v2 = summarizeCosts(visits, ledger, { visitId: 'v2' });
    expect(v2.ticketsUnrecorded).toBe(1);
    expect(v2.twd.ticket).toBe(150);
    expect(Object.is(summarizeCosts([], [], 'all').twd.passport, 0)).toBe(true);
  });
});

describe('護照與門票儲存', () => {
  it('辦理費、補發費記成護照費（不屬於任何入園）；改費用、移除會同步帳', async () => {
    const d = fresh();
    await saveChild({ name: '小明', birthday: BDAY }, d);
    const p = await savePassport({ issuedOn: '2026-01-10' }, d);
    expect(p.fee).toBe(399);
    const fee = await d.ledger.get(p.feeEntryId!);
    expect(fee).toMatchObject({ amount: -399, currency: 'TWD', twdCategory: 'passport' });
    expect(fee!.visitId).toBeUndefined();

    await savePassport({ issuedOn: '2026-01-11', fee: 0 }, d); // 例如活動贈送
    expect(await d.ledger.count()).toBe(0);
    await savePassport({ issuedOn: '2026-01-11', fee: 399 }, d);
    expect(await d.ledger.count()).toBe(1);

    const r = await addReplacement({ date: '2026-10-01' }, d);
    expect(r.replacements[0]).toMatchObject({ date: '2026-10-01', fee: 150 });
    expect((await d.ledger.get(r.replacements[0]!.entryId!))!.amount).toBe(-150);
    await expect(addReplacement({ date: '2025-01-01' }, d)).rejects.toThrow('不可早於辦理日期');

    await removePassport(d);
    expect((await d.child.get('kid'))!.passport).toBeNull();
    expect(await d.ledger.count()).toBe(0);
  });

  it('手動升級：依序、不可早於上次、最高榮譽市民；可取消；建立時可指定目前等級', async () => {
    const d = fresh();
    await savePassport({ issuedOn: '2026-01-10' }, d);
    await expect(recordUpgrade('2026-01-01', d)).rejects.toThrow('不可早於');
    await recordUpgrade('2026-05-01', d);
    const p = await recordUpgrade('2026-09-01', d);
    expect(p.upgrades.map((u) => u.level)).toEqual(['outstanding', 'honor']);
    await expect(recordUpgrade('2026-10-01', d)).rejects.toThrow('最高等級');
    expect(currentLevel(await undoUpgrade(d))).toBe('outstanding');

    const d2 = fresh();
    const q = await savePassport({ issuedOn: '2025-01-01', level: 'outstanding', levelSince: '2025-12-01' }, d2);
    expect(levelOn(q, '2025-11-30')).toBe('model');
    expect(levelOn(q, '2025-12-01')).toBe('outstanding');
  });

  it('門票價格表可改、可恢復預設；入園門票可記錄或改回未記錄', async () => {
    const d = fresh();
    await saveTicketPrices({ child: 1500 }, '2026-12-01', d);
    let c = await d.child.get('kid');
    expect(c!.ticketPrices).toEqual({ prices: { ...DEFAULT_TICKET_PRICES, child: 1500 }, updatedOn: '2026-12-01' });
    await resetTicketPrices(d);
    c = await d.child.get('kid');
    expect(c!.ticketPrices).toBeUndefined();

    const v = await createVisit({}, d);
    await saveVisitTickets(v.id, [{ type: 'child', label: '孩童／學生', qty: 1, listPrice: 1400, paidPrice: 1400 }], d);
    expect((await d.visits.get(v.id))!.tickets).toHaveLength(1);
    await saveVisitTickets(v.id, null, d);
    expect('tickets' in (await d.visits.get(v.id))!).toBe(false);
  });
});

describe('備份', () => {
  it('匯出／匯入包含護照、價格表、門票、分類與加碼欄位', async () => {
    const d = fresh();
    await saveChild({ name: '小明', birthday: BDAY }, d);
    await savePassport({ issuedOn: '2026-01-10' }, d);
    await saveTicketPrices({ adult: 650 }, '2026-12-01', d);
    const v = await createVisit({ visitDate: '2026-02-01' }, d);
    await saveVisitTickets(v.id, [{ type: 'adult', label: '成人陪同', qty: 2, listPrice: 700, paidPrice: 650 }], d);
    await addCompletion({ jobId: 'job-vet', visitId: v.id, completedAt: at('2026-02-01'), applyPassportPerk: true }, d);
    await addManualEntry({ type: 'purchase', amount: -45, passportBonus: 5, visitId: v.id }, d);
    const { blob } = await exportBackup({}, d);

    const d2 = fresh();
    await importBackup(blob, 'replace', d2);
    const c = await d2.child.get('kid');
    expect(c!.passport!.issuedOn).toBe('2026-01-10');
    expect(c!.ticketPrices!.prices.adult).toBe(650);
    expect((await d2.visits.get(v.id))!.tickets![0]!.paidPrice).toBe(650);
    const ledger = await d2.ledger.toArray();
    expect(ledger.find((e) => e.twdCategory === 'passport')!.amount).toBe(-399);
    expect(ledger.filter((e) => e.passportBonus).map((e) => e.passportBonus).sort()).toEqual([2, 5]);
  });

  it('舊版備份（沒有新欄位）可匯入，總覽顯示未記錄門票、舊自費依規則分類', async () => {
    const manifest = {
      app: 'kidzania-passport',
      schemaVersion: 1,
      exportedAt: '2026-11-01T02:00:00.000Z',
      child: { id: 'kid', name: '小明', birthday: BDAY },
      visits: [{ id: 'old-v', visitDate: '2026-10-01', startingKidzos: 50, createdAt: 1 }],
      completions: [{ id: 'old-c', jobId: 'job-yakiniku', visitId: 'old-v', completedAt: at('2026-10-01') }],
      ledger: [
        { id: 'g', visitId: 'old-v', at: 1, type: 'grant', amount: 50, currency: 'kidZos' },
        { id: 'f', visitId: 'old-v', at: 2, type: 'twd_fee', amount: -199, currency: 'TWD', jobId: 'job-yakiniku', completionId: 'old-c' },
        { id: 'o', visitId: 'old-v', at: 3, type: 'twd_fee', amount: -60, currency: 'TWD', note: '停車' },
      ],
      blobs: [],
      settings: [],
      includesOfficialMaps: false,
    };
    const blob = new Blob([zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) }) as Uint8Array<ArrayBuffer>]);
    const d = fresh();
    await importBackup(blob, 'replace', d);
    const child = await d.child.get('kid');
    expect(child!.passport).toBeUndefined();
    expect(ticketPricesOf(child).prices.child).toBe(1400);
    const s = summarizeCosts(await d.visits.toArray(), await d.ledger.toArray(), 'all');
    expect(s.ticketsUnrecorded).toBe(1);
    expect(s.twd).toEqual({ passport: 0, ticket: 0, job: 199, other: 60, total: 259 });
  });
});
