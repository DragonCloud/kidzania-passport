import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { AppDB } from '../db/db';
import type { Completion, LedgerEntry } from '../types/models';
import { todayISO } from './age';
import { saveChild } from './child';
import { addCompletion, updateCompletion } from './completions';
import { MANUAL_TWD_CATEGORIES } from './costs';
import { localDateISO } from './format';
import { sumKidzos, updateEntry } from './ledger';
import { countsTowardPassport, isBeforePassport, stampProgress } from './passport';
import { addReplacement, recordUpgrade, removePassport, savePassport, setPassportIssuedAt } from './passportStore';
import { createVisit, dateStartMs, listVisits, pickCurrentVisit } from './visits';

// 假資料：孩子「小明」，生日 2020-03-15
const BDAY = '2020-03-15';
const DAY = '2026-11-20';
const at = (h: number, m = 0) => dateStartMs(DAY) + h * 3_600_000 + m * 60_000;
const FIVE = ['job-vet', 'job-baseball', 'job-cheerleader', 'job-basketball', 'job-esports'];
const TABLE: Record<string, number> = { 'job-vet': 10, 'job-baseball': -5, 'job-cheerleader': -5, 'job-basketball': -5, 'job-esports': -5, 'job-tcm-doctor': -10 };

let n = 0;
const dbs: AppDB[] = [];
async function fresh() {
  const d = new AppDB(`v031-test-${++n}`);
  dbs.push(d);
  await saveChild({ name: '小明', birthday: BDAY }, d);
  return d;
}
afterEach(async () => {
  for (const d of dbs.splice(0)) await d.delete();
});

const kidzosAuto = async (d: AppDB) =>
  (await d.ledger.toArray()).filter((e) => e.completionId && e.currency === 'kidZos').sort((a, b) => a.at - b.at);
async function progress(d: AppDB) {
  const c = (await d.child.get('kid'))!;
  return stampProgress(c.passport!, await d.completions.toArray(), c.birthday);
}

describe('辦護照前的章不算（時間戳判斷）', () => {
  it('同一天先蓋 5 個章 → 建立護照（預設現在）→ 再蓋 1 個：進度 1；只有最後那筆有加碼；前 5 筆是表定值', async () => {
    const d = await fresh();
    const now = Date.now();
    const v = await createVisit({ visitDate: todayISO() }, d);
    for (const [i, jobId] of FIVE.entries()) {
      // 蓋章頁「套用護照加碼」預設開；當時還沒有護照
      await addCompletion({ jobId, visitId: v.id, completedAt: now - (10 - i) * 60_000, applyPassportPerk: true }, d);
    }
    await savePassport({ issuedOn: todayISO() }, d); // 建立：辦理時間＝按下的那一刻
    const p = (await d.child.get('kid'))!.passport!;
    expect(p.issuedAt).toBeGreaterThanOrEqual(now);
    await addCompletion({ jobId: 'job-vet', visitId: v.id, completedAt: Date.now() + 1, applyPassportPerk: true }, d);

    const pr = await progress(d);
    expect(pr.count).toBe(1);
    expect(pr.remaining).toBe(29);
    const auto = await kidzosAuto(d);
    expect(auto).toHaveLength(6);
    expect(auto.filter((e) => e.passportBonus)).toHaveLength(1);
    expect(auto.at(-1)).toMatchObject({ amount: 12, passportBonus: 2, note: '動物醫師（模範市民加碼 +2）' });
    expect(auto.slice(0, 5).map((e) => e.amount)).toEqual(FIVE.map((j) => TABLE[j]));
    expect(auto.slice(0, 5).every((e) => !e.note!.includes('加碼'))).toBe(true);
    // 辦護照前的章仍在收集裡，標「辦護照前」
    const comps = await d.completions.toArray();
    expect(comps).toHaveLength(6);
    expect(comps.filter((c) => isBeforePassport(c, p))).toHaveLength(5);
  });

  it('先蓋章、後補登護照（辦理時間比部分章晚）：辦理後的章取得加碼、辦理前的不加；帳筆數與 id 不變', async () => {
    const d = await fresh();
    for (const [i, jobId] of FIVE.entries()) await addCompletion({ jobId, completedAt: at(10 + i), applyPassportPerk: true }, d);
    const before = await kidzosAuto(d);
    await savePassport({ issuedOn: DAY, issuedAt: at(12, 30) }, d); // 10、11、12 點的在辦理前
    const after = await kidzosAuto(d);
    expect(after.map((e) => e.id)).toEqual(before.map((e) => e.id));
    expect(after.map((e) => e.amount)).toEqual([10, -5, -5, -3, -3]);
    expect(after.map((e) => e.passportBonus ?? 0)).toEqual([0, 0, 0, 2, 2]);
    expect((await progress(d)).count).toBe(2);
  });

  it('辦理時間改晚：已加碼的辦理前章失去加碼、備註拿掉「加碼」；帳筆數不變', async () => {
    const d = await fresh();
    await savePassport({ issuedOn: DAY, issuedAt: at(9) }, d);
    for (const [i, jobId] of FIVE.entries()) await addCompletion({ jobId, completedAt: at(10 + i), applyPassportPerk: true }, d);
    expect((await kidzosAuto(d)).every((e) => e.passportBonus === 2)).toBe(true);
    const count = await d.ledger.count();
    await savePassport({ issuedOn: DAY, issuedAt: at(12, 30) }, d);
    const after = await kidzosAuto(d);
    expect(await d.ledger.count()).toBe(count);
    expect(after.slice(0, 3)).toEqual(
      after.slice(0, 3).map((e, i) => ({ ...e, amount: TABLE[FIVE[i]!], note: ['動物醫師', '棒球選手', '啦啦隊員'][i] })),
    );
    expect(after.slice(0, 3).some((e) => 'passportBonus' in e)).toBe(false);
  });

  it('舊護照（v0.3.0，沒有 issuedAt）一鍵修正後進度正確，加碼帳只保留辦理後那筆', async () => {
    const d = await fresh();
    // v0.3.0 的資料：同一天 9～13 點蓋 5 個章（當時沒護照、沒加碼），14 點建立護照，15 點再蓋 1 個（有加碼）
    const comps: Completion[] = [...FIVE, 'job-tcm-doctor'].map((jobId, i) => ({ id: `c${i}`, jobId, completedAt: at(i < 5 ? 9 + i : 15) }));
    const ledger: LedgerEntry[] = comps.map((c, i) => ({
      id: `e${i}`,
      completionId: c.id,
      jobId: c.jobId,
      at: c.completedAt,
      currency: 'kidZos',
      type: TABLE[c.jobId]! > 0 ? 'earn' : 'spend',
      amount: i < 5 ? TABLE[c.jobId]! : -8,
      ...(i < 5 ? { note: c.jobId } : { passportBonus: 2, note: '中醫師（模範市民減免 2）' }),
    }));
    await d.completions.bulkAdd(comps);
    await d.ledger.bulkAdd(ledger);
    const child = (await d.child.get('kid'))!;
    await d.child.put({ ...child, passport: { issuedOn: DAY, fee: 399, upgrades: [], replacements: [] } });

    expect((await progress(d)).count).toBe(6); // 舊版的錯誤：辦理當天全部算進去
    await setPassportIssuedAt(at(14), d);
    const pr = await progress(d);
    expect(pr.count).toBe(1);
    expect((await d.child.get('kid'))!.passport).toMatchObject({ issuedOn: DAY, issuedAt: at(14) });
    const auto = await kidzosAuto(d);
    expect(auto.map((e) => e.amount)).toEqual([10, -5, -5, -5, -5, -8]);
    expect(auto.filter((e) => e.passportBonus).map((e) => e.id)).toEqual(['e5']);
  });

  it('改蓋章時間跨過辦理時間：加碼跟著消失／出現（同一個 id）；跨過升級時間依新等級', async () => {
    const d = await fresh();
    await savePassport({ issuedOn: DAY, issuedAt: at(12) }, d);
    const { completion, entries } = await addCompletion({ jobId: 'job-vet', completedAt: at(13), applyPassportPerk: true }, d);
    const id = entries[0]!.id;
    expect((await d.ledger.get(id))!.amount).toBe(12);
    await updateCompletion(completion.id, { completedAt: at(11) }, d);
    expect(await d.ledger.get(id)).toMatchObject({ amount: 10, at: at(11), note: '動物醫師' });
    expect((await d.ledger.get(id))!.passportBonus).toBeUndefined();
    await updateCompletion(completion.id, { completedAt: at(14) }, d);
    expect(await d.ledger.get(id)).toMatchObject({ amount: 12, passportBonus: 2 });
    await recordUpgrade(DAY, d, at(16));
    await updateCompletion(completion.id, { completedAt: at(17) }, d);
    expect(await d.ledger.get(id)).toMatchObject({ amount: 14, passportBonus: 4, note: '動物醫師（傑出市民加碼 +4）' });
    expect(await d.ledger.count()).toBe(2); // 自動帳＋辦理費，沒有新增
  });

  it('升級時間用時間戳；當天升級前蓋的章維持原等級', async () => {
    const d = await fresh();
    await savePassport({ issuedOn: '2026-01-10', issuedAt: dateStartMs('2026-01-10') + 10 * 3_600_000 }, d);
    const early = await addCompletion({ jobId: 'job-vet', completedAt: at(10), applyPassportPerk: true }, d);
    const late = await addCompletion({ jobId: 'job-vet', completedAt: at(15), applyPassportPerk: true }, d);
    await recordUpgrade(DAY, d, at(12));
    expect((await d.ledger.get(early.entries[0]!.id))!.amount).toBe(12);
    expect((await d.ledger.get(late.entries[0]!.id))!.amount).toBe(14); // 重算後套用傑出
    expect((await progress(d)).count).toBe(1); // 只算升級後
  });

  it('蓋章時關掉「套用護照加碼」的章、手動改過金額的帳，重算都不動', async () => {
    const d = await fresh();
    await savePassport({ issuedOn: DAY, issuedAt: at(8) }, d);
    const off = await addCompletion({ jobId: 'job-vet', completedAt: at(9), applyPassportPerk: false }, d);
    const manual = await addCompletion({ jobId: 'job-baseball', completedAt: at(10), applyPassportPerk: true }, d);
    expect((await d.completions.get(off.completion.id))!.passportPerk).toBe(false);
    await updateEntry(manual.entries[0]!.id, { amount: -1 }, d); // 現場實際付 1
    await recordUpgrade(DAY, d, at(8, 30));
    expect((await d.ledger.get(off.entries[0]!.id))!.amount).toBe(10);
    expect((await d.ledger.get(manual.entries[0]!.id))!.amount).toBe(-1);
    // 舊資料沒有 passportPerk：沒有加碼 → 視為沒選，不動
    const c = (await d.completions.get(manual.completion.id))!;
    delete c.passportPerk;
    await d.completions.put(c);
    await updateEntry(manual.entries[0]!.id, { amount: -5, passportBonus: undefined }, d);
    await removePassport(d);
    expect((await d.ledger.get(manual.entries[0]!.id))!.amount).toBe(-5);
  });

  it('手動指定算／不算護照章：進度以手動為優先', async () => {
    const d = await fresh();
    await savePassport({ issuedOn: DAY, issuedAt: at(12) }, d);
    const pre = await addCompletion({ jobId: 'job-vet', completedAt: at(10), applyPassportPerk: true }, d);
    const post = await addCompletion({ jobId: 'job-baseball', completedAt: at(13), applyPassportPerk: true }, d);
    expect((await progress(d)).count).toBe(1);
    await updateCompletion(pre.completion.id, { countsForPassport: true }, d);
    await updateCompletion(post.completion.id, { countsForPassport: false }, d);
    expect((await progress(d)).count).toBe(1);
    const p = (await d.child.get('kid'))!.passport!;
    expect(countsTowardPassport((await d.completions.get(pre.completion.id))!, p, BDAY)).toBe(true);
    expect(isBeforePassport((await d.completions.get(pre.completion.id))!, p)).toBe(false);
    await updateCompletion(pre.completion.id, { countsForPassport: null }, d);
    expect('countsForPassport' in (await d.completions.get(pre.completion.id))!).toBe(false);
    expect((await progress(d)).count).toBe(0);
    // 手動指定只影響進度，不影響加碼
    expect((await d.ledger.get(pre.entries[0]!.id))!.amount).toBe(10);
  });
});

describe('護照費固定 id', () => {
  it('辦理費用 passport-fee、補發費用 passport-replacement-<日期>；重複建立不會多一筆', async () => {
    const d = await fresh();
    await savePassport({ issuedOn: DAY, issuedAt: at(9) }, d);
    await savePassport({ issuedOn: DAY, issuedAt: at(9) }, d);
    const p = await addReplacement({ date: '2026-11-25' }, d);
    expect(p.feeEntryId).toBe('passport-fee');
    expect(p.replacements[0]!.entryId).toBe('passport-replacement-2026-11-25');
    await expect(addReplacement({ date: '2026-11-25' }, d)).rejects.toThrow('已經記錄過');
    expect((await d.ledger.toArray()).map((e) => e.id).sort()).toEqual(['passport-fee', 'passport-replacement-2026-11-25']);
  });

  it('舊資料已有隨機 id 的辦理費：保留，不再新增一筆', async () => {
    const d = await fresh();
    const child = (await d.child.get('kid'))!;
    await d.ledger.add({ id: 'legacy-random-id', at: at(9), type: 'twd_fee', amount: -399, currency: 'TWD', twdCategory: 'passport' });
    await d.child.put({ ...child, passport: { issuedOn: DAY, fee: 399, feeEntryId: 'legacy-random-id', upgrades: [], replacements: [] } });
    await savePassport({ issuedOn: DAY, fee: 399 }, d);
    await setPassportIssuedAt(at(10), d);
    const fees = (await d.ledger.toArray()).filter((e) => e.twdCategory === 'passport');
    expect(fees.map((e) => e.id)).toEqual(['legacy-random-id']);
    expect(fees[0]!.at).toBe(at(10));
  });

  it('移除後重建：刪過的 id 不能在雲端復活，改用 passport-fee-2', async () => {
    const d = await fresh();
    await savePassport({ issuedOn: DAY, issuedAt: at(9) }, d);
    await removePassport(d);
    const p = await savePassport({ issuedOn: DAY, issuedAt: at(9) }, d);
    expect(p.feeEntryId).toBe('passport-fee-2');
    expect(await d.ledger.count()).toBe(1);
  });
});

describe('其他修正', () => {
  it('手動記帳的新臺幣分類只有職業自費和其他', () => {
    expect(MANUAL_TWD_CATEGORIES).toEqual(['job', 'other']);
  });

  it('同一天兩筆入園：錢包預設分頁與護照頁卡片都選今天最後建立的那筆，kidZos 一致', async () => {
    const d = await fresh();
    const today = todayISO();
    const a = await createVisit({ visitDate: today }, d);
    await new Promise((r) => setTimeout(r, 5));
    const b = await createVisit({ visitDate: today, startingKidzos: 30 }, d);
    await createVisit({ visitDate: '2099-01-01' }, d); // 日期打錯的未來入園不應被選到
    await addCompletion({ jobId: 'job-vet', visitId: a.id }, d);
    const visits = await listVisits(d);
    const picked = pickCurrentVisit(visits, today)!;
    expect(picked.id).toBe(b.id);
    const bal = async (id: string) => sumKidzos(await d.ledger.where('visitId').equals(id).toArray());
    expect(await bal(picked.id)).toBe(30);
    expect(localDateISO(Date.now())).toBe(today);
  });
});
