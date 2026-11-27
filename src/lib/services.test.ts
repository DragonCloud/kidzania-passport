import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDB } from '../db/db';
import { saveChild } from './child';
import { addCompletion, checkBalance, deleteCompletion, statsByJob, updateCompletion } from './completions';
import { addManualEntry, balanceForVisit, sumKidzos, sumTwdSpent } from './ledger';
import { createVisit, deleteVisit, previousVisitBalance, updateVisit } from './visits';
import { exportBackup, importBackup, inspectBackup } from './backup';

let d: AppDB;
let n = 0;

beforeEach(() => {
  d = new AppDB(`test-${++n}`);
});
afterEach(async () => {
  await d.delete();
});

const jpeg = (s: string) => new Blob([s], { type: 'image/jpeg' });
const photo = () => ({ full: jpeg('full'), thumb: jpeg('thumb') });

describe('入園與錢包', () => {
  it('建立入園自動 +50；可改起始資金', async () => {
    const v = await createVisit({ visitDate: '2026-11-28' }, d);
    expect(await balanceForVisit(v.id, d)).toBe(50);
    await updateVisit(v.id, { startingKidzos: 63 }, d);
    expect(await balanceForVisit(v.id, d)).toBe(63);
    expect(await d.ledger.where('visitId').equals(v.id).count()).toBe(1);
  });

  it('蓋章自動記帳：賺、付、新臺幣分開', async () => {
    const v = await createVisit({ visitDate: '2026-11-28' }, d);
    await addCompletion({ jobId: 'job-vet', visitId: v.id }, d); // +10
    await addCompletion({ jobId: 'job-cheerleader', visitId: v.id }, d); // -5
    await addCompletion({ jobId: 'job-yakiniku', visitId: v.id }, d); // NT$199
    await addCompletion({ jobId: 'job-pizza-chef', visitId: v.id }, d); // 未列 → 不記帳
    const entries = await d.ledger.toArray();
    expect(sumKidzos(entries)).toBe(55);
    expect(sumTwdSpent(entries)).toBe(199);
    expect(entries).toHaveLength(4); // grant + earn + spend + twd
  });

  it('餘額不足檢查；可只蓋章不扣', async () => {
    const v = await createVisit({ visitDate: '2026-11-28', startingKidzos: 5 }, d);
    expect((await checkBalance('job-tcm-doctor', v.id, d)).insufficient).toBe(true); // -10
    await addCompletion({ jobId: 'job-tcm-doctor', visitId: v.id, chargeKidzos: false }, d);
    expect(await balanceForVisit(v.id, d)).toBe(5);
  });

  it('手動記帳', async () => {
    const v = await createVisit({ visitDate: '2026-11-28' }, d);
    await addManualEntry({ visitId: v.id, type: 'purchase', amount: -30, note: '貼紙' }, d);
    expect(await balanceForVisit(v.id, d)).toBe(20);
    await expect(addManualEntry({ type: 'adjust', amount: 0 }, d)).rejects.toThrow();
  });

  it('上次餘額可當下次起始參考', async () => {
    const v1 = await createVisit({ visitDate: '2026-11-01' }, d);
    await addCompletion({ jobId: 'job-vet', visitId: v1.id }, d);
    const v2 = await createVisit({ visitDate: '2026-12-01', startingKidzos: 0 }, d);
    const prev = await previousVisitBalance(v2.id, d);
    expect(prev?.visit.id).toBe(v1.id);
    expect(prev?.balance).toBe(60);
  });

  it('刪除入園：預設保留完成紀錄', async () => {
    const v = await createVisit({}, d);
    const { completion } = await addCompletion({ jobId: 'job-vet', visitId: v.id }, d);
    await deleteVisit(v.id, {}, d);
    expect((await d.completions.get(completion.id))?.visitId).toBeUndefined();
    expect(await d.ledger.filter((e) => e.type === 'grant').count()).toBe(0);
    expect(await d.ledger.count()).toBe(1);
  });
});

describe('完成紀錄', () => {
  it('照片寫入、更換、刪除會清掉舊 blob', async () => {
    const { completion } = await addCompletion({ jobId: 'job-vet', photo: photo() }, d);
    expect(await d.blobs.count()).toBe(2);
    await updateCompletion(completion.id, { photo: photo() }, d);
    expect(await d.blobs.count()).toBe(2);
    await updateCompletion(completion.id, { photo: null }, d);
    expect(await d.blobs.count()).toBe(0);
  });

  it('改時間與入園會同步到自動帳；刪除預設連帳一起刪', async () => {
    const v = await createVisit({}, d);
    const { completion } = await addCompletion({ jobId: 'job-vet', completedAt: 1000 }, d);
    await updateCompletion(completion.id, { completedAt: 2000, visitId: v.id }, d);
    const e = await d.ledger.where('completionId').equals(completion.id).first();
    expect(e?.at).toBe(2000);
    expect(e?.visitId).toBe(v.id);
    await deleteCompletion(completion.id, {}, d);
    expect(await d.ledger.where('completionId').equals(completion.id).count()).toBe(0);
  });

  it('同職業可再訪，統計次數', async () => {
    await addCompletion({ jobId: 'job-vet', completedAt: 1 }, d);
    await addCompletion({ jobId: 'job-vet', completedAt: 5 }, d);
    const s = statsByJob(await d.completions.toArray());
    expect(s.get('job-vet')).toEqual({ count: 2, lastAt: 5 });
  });

  it('不存在的職業拒絕', async () => {
    await expect(addCompletion({ jobId: 'job-nope' }, d)).rejects.toThrow();
  });
});

describe('備份 ZIP', () => {
  it('匯出後在新資料庫匯入，內容一致', async () => {
    await saveChild({ name: '小明', birthday: '2020-03-15' }, d);
    const v = await createVisit({ visitDate: '2026-11-28' }, d);
    await addCompletion({ jobId: 'job-vet', visitId: v.id, photo: photo() }, d);
    await d.blobs.add({ id: 'map1', kind: 'official-map', mime: 'image/jpeg', data: jpeg('map'), createdAt: 1 });

    const { blob, manifest } = await exportBackup({}, d);
    expect(manifest.includesOfficialMaps).toBe(false);
    expect(manifest.blobs).toHaveLength(2); // 只有照片＋縮圖，不含官方地圖
    expect((await inspectBackup(blob)).photos).toBe(1);

    const d2 = new AppDB(`test-import-${n}`);
    await d2.blobs.add({ id: 'local-map', kind: 'official-map', mime: 'image/jpeg', data: jpeg('m'), createdAt: 1 });
    await importBackup(blob, 'replace', d2);
    expect((await d2.child.get('kid'))?.name).toBe('小明');
    expect(await d2.completions.count()).toBe(1);
    expect(await balanceForVisit(v.id, d2)).toBe(60);
    const photoBlob = await d2.blobs.where('kind').equals('photo').first();
    expect(await photoBlob!.data.text()).toBe('full');
    expect(await d2.blobs.get('local-map')).toBeDefined(); // 備份無地圖 → 保留本機地圖
    await d2.delete();
  });

  it('拒絕不是備份的檔案', async () => {
    await expect(importBackup(new Blob(['hello']), 'merge', d)).rejects.toThrow('無法解開 ZIP 檔');
  });
});

import { looksLikeFullPage, removeOfficialMap, saveOfficialMap } from './officialMap';
import { getSetting } from './settings';

describe('本機官方地圖', () => {
  it('載入、替換、移除都會清掉舊圖', async () => {
    const id1 = await saveOfficialMap(1, jpeg('a'), d);
    expect(await getSetting('officialMap1F', d)).toBe(id1);
    const id2 = await saveOfficialMap(1, jpeg('b'), d);
    expect(await d.blobs.get(id1)).toBeUndefined();
    expect(await getSetting('officialMap1F', d)).toBe(id2);
    await removeOfficialMap(1, d);
    expect(await d.blobs.count()).toBe(0);
    expect(await getSetting('officialMap1F', d)).toBeNull();
  });
  it('整頁比例判斷', () => {
    expect(looksLikeFullPage(3509, 2481)).toBe(true);
    expect(looksLikeFullPage(1755, 1241)).toBe(true);
    expect(looksLikeFullPage(1170, 2532)).toBe(false); // 手機截圖
  });
});
