import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppDB } from '../db/db';
import { saveChild } from '../lib/child';
import { addCompletion, deleteCompletion, updateCompletion } from '../lib/completions';
import { addManualEntry } from '../lib/ledger';
import { saveOfficialMap } from '../lib/officialMap';
import { setSetting } from '../lib/settings';
import { restoreTrashLocal } from '../lib/trash';
import { createVisit } from '../lib/visits';
import { recordUpgrade, savePassport, saveTicketPrices, saveVisitTickets } from '../lib/passportStore';
import { clearSyncedLocalData, getSyncState, loadSyncFamily, localDataCount, PAUSE_AFTER_MS, SyncEngine, type EngineOptions } from './engine';
import { syncRuntime } from './hooks';
import { MemoryRemoteStore } from './testing/memoryRemote';
import { SupabaseRemoteStore } from './supabaseRemote';
import type { SupabaseClient } from '@supabase/supabase-js';

const FID = 'fam-test';
const jpeg = (s: string) => new Blob([s], { type: 'image/jpeg' });
const photo = (tag = 'p') => ({ full: jpeg(`full-${tag}`), thumb: jpeg(`thumb-${tag}`) });

let n = 0;
const dbs: AppDB[] = [];
const engines: SyncEngine[] = [];
function device(): AppDB {
  const d = new AppDB(`engine-test-${++n}`);
  dbs.push(d);
  return d;
}
function engine(d: AppDB, remote: MemoryRemoteStore, opts: EngineOptions = {}) {
  const e = new SyncEngine(d, remote, FID, opts);
  engines.push(e);
  return e;
}
/** 等 hooks 在交易完成後補寫 outbox */
const settle = () => new Promise((r) => setTimeout(r, 20));

afterEach(async () => {
  engines.splice(0).forEach((e) => e.stop());
  for (const d of dbs.splice(0)) await d.delete();
});

/** 兩支手機都已加入同一個家庭 */
async function twoDevices() {
  const remote = new MemoryRemoteStore();
  const A = device();
  const B = device();
  const eA = engine(A, remote);
  const eB = engine(B, remote);
  await eA.attach('upload');
  await eB.attach('discard');
  return { remote, A, B, eA, eB };
}

describe('hooks 與 outbox', () => {
  it('未加入家庭時不記錄；加入後新增／修改／刪除都進 outbox，同一筆只留最新一次', async () => {
    const d = device();
    await addManualEntry({ type: 'adjust', amount: 5 }, d);
    await settle();
    expect(await d.outbox.count()).toBe(0);

    syncRuntime(d).familyId = FID;
    const e = await addManualEntry({ type: 'adjust', amount: 3 }, d);
    await settle();
    await d.ledger.update(e.id, { amount: 4 });
    await settle();
    const rows = await d.outbox.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tbl: 'ledger', rowId: e.id, op: 'put' });
    await d.ledger.delete(e.id);
    await settle();
    expect((await d.outbox.toArray())[0]).toMatchObject({ op: 'delete', snapshot: { id: e.id, amount: 4 } });
  });

  it('官方地圖與 settings 永不進 outbox、也不會上傳', async () => {
    const remote = new MemoryRemoteStore();
    const d = device();
    const eng = engine(d, remote);
    await eng.attach('upload');
    await saveOfficialMap(1, jpeg('map'), d);
    await setSetting('soundOn', false, d);
    await settle();
    expect(await d.outbox.count()).toBe(0);
    await eng.syncNow();
    expect(remote.count(FID)).toBe(0);
    expect(remote.photos.size).toBe(0);
  });

  it('套用雲端資料不會回送', async () => {
    const { A, B, eA, eB } = await twoDevices();
    await addCompletion({ jobId: 'job-vet' }, A);
    await settle();
    await eA.syncNow();
    await eB.syncNow();
    expect(await B.completions.count()).toBe(1);
    await settle();
    expect(await B.outbox.count()).toBe(0);
  });
});

describe('兩支手機互相同步', () => {
  it('A 蓋章（含照片）→ B 看到紀錄、帳、縮圖；原圖打開時才下載', async () => {
    const { remote, A, B, eA, eB } = await twoDevices();
    const v = await createVisit({ visitDate: '2026-11-28' }, A);
    const { completion } = await addCompletion({ jobId: 'job-vet', visitId: v.id, photo: photo('vet') }, A);
    await settle();
    await eA.syncNow();
    expect(eA.status.phase).toBe('synced');
    expect(await A.outbox.count()).toBe(0);

    await eB.syncNow();
    const c = await B.completions.get(completion.id);
    expect(c?.jobId).toBe('job-vet');
    expect(await B.ledger.where('visitId').equals(v.id).count()).toBe(2); // 起始 50 ＋ 賺 10
    const thumb = await B.blobs.get(completion.thumbBlobId!);
    expect(await thumb!.data!.text()).toBe('thumb-vet');
    const full = await B.blobs.get(completion.photoBlobId!);
    expect(full!.data).toBeUndefined();
    expect(remote.calls.filter((x) => x === 'download')).toHaveLength(1);
    await eB.ensureBlob(completion.photoBlobId!);
    expect(await (await B.blobs.get(completion.photoBlobId!))!.data!.text()).toBe('full-vet');
  });

  it('照片先上傳 Storage 再寫中繼資料；上傳失敗時中繼資料不寫、outbox 保留，重試後成功', async () => {
    const remote = new MemoryRemoteStore();
    const A = device();
    const eA = engine(A, remote);
    await eA.attach('upload');
    const { completion } = await addCompletion({ jobId: 'job-vet', photo: photo() }, A);
    await settle();
    remote.failNext('upload');
    await eA.syncNow();
    expect(eA.status.phase).toBe('offline');
    expect(remote.get(FID, 'blobs', completion.photoBlobId!)).toBeUndefined();
    expect(await A.outbox.count()).toBeGreaterThan(0);
    expect(eA.backoffMs).toBe(5000);

    await eA.syncNow();
    expect(eA.status.phase).toBe('synced');
    const first = remote.calls.indexOf('upload');
    expect(remote.calls.indexOf('upsert', first)).toBeGreaterThan(first);
    expect(remote.get(FID, 'blobs', completion.photoBlobId!)?.data).toMatchObject({ path: `${FID}/${completion.photoBlobId}.jpg`, kind: 'photo' });
    expect(remote.photos.has(`${FID}/${completion.photoBlobId}.jpg`)).toBe(true);
    expect(await A.outbox.count()).toBe(0);
  });

  it('離線蓋章：資料留在 outbox；恢復連線後自動上傳', async () => {
    const { remote, A, B, eA, eB } = await twoDevices();
    remote.offline = true;
    await addCompletion({ jobId: 'job-police' }, A);
    await settle();
    await eA.syncNow();
    expect(eA.status.phase).toBe('offline');
    expect(await A.outbox.count()).toBe(2); // 紀錄＋賺 10 kidZos 的帳
    remote.offline = false;
    await eA.syncNow();
    expect(await A.outbox.count()).toBe(0);
    await eB.syncNow();
    expect((await B.completions.toArray()).map((c) => c.jobId)).toEqual(['job-police']);
  });

  it('推送期間又被修改的紀錄保留在 outbox，下一輪再送', async () => {
    const remote = new MemoryRemoteStore();
    const A = device();
    const eA = engine(A, remote);
    await eA.attach('upload');
    const e = await addManualEntry({ type: 'adjust', amount: 1 }, A);
    await settle();
    const orig = remote.upsertRecords.bind(remote);
    let once = true;
    vi.spyOn(remote, 'upsertRecords').mockImplementation(async (fid, rows) => {
      if (once) {
        once = false;
        await A.ledger.update(e.id, { amount: 99 });
        await settle();
      }
      return orig(fid, rows);
    });
    await eA.syncNow();
    expect((remote.get(FID, 'ledger', e.id)?.data as { amount: number }).amount).toBe(99);
    expect(await A.outbox.count()).toBe(0);
  });

  it('最後寫到伺服器者勝；本機待送時忽略雲端', async () => {
    const { A, B, eA, eB } = await twoDevices();
    const { completion } = await addCompletion({ jobId: 'job-vet', note: '原本' }, A);
    await settle();
    await eA.syncNow();
    await eB.syncNow();

    await updateCompletion(completion.id, { note: 'A 改的' }, A);
    await updateCompletion(completion.id, { note: 'B 改的' }, B);
    await settle();
    await eA.syncNow(); // A 先送到
    // B 還沒送：拉取時本機待送 → 不被 A 覆蓋
    await eB.pull();
    expect((await B.completions.get(completion.id))!.note).toBe('B 改的');
    await eB.syncNow(); // B 後送到 → B 勝
    await eA.syncNow();
    expect((await A.completions.get(completion.id))!.note).toBe('B 改的');
    expect((await B.completions.get(completion.id))!.note).toBe('B 改的');
  });

  it('重疊拉取是冪等的：重複套用不重複、不產生 outbox、游標不倒退', async () => {
    const { remote, A, B, eA, eB } = await twoDevices();
    for (const job of ['job-vet', 'job-police', 'job-nurse']) await addCompletion({ jobId: job }, A);
    await settle();
    await eA.syncNow();
    await eB.syncNow();
    const cursor1 = await getSyncState<string>(B, 'cursor');
    await eB.pull();
    await eB.pull();
    await eB.applyRemote(await remote.pullSince(FID, null, 500));
    await settle();
    expect(await B.completions.count()).toBe(3);
    expect(await B.outbox.count()).toBe(0);
    expect((await getSyncState<string>(B, 'cursor'))! >= cursor1!).toBe(true);
  });

  it('Realtime：對方的變更推過來即套用', async () => {
    const remote = new MemoryRemoteStore();
    const A = device();
    const B = device();
    const eA = engine(A, remote);
    const eB = engine(B, remote, { autoSchedule: true, debounceMs: 0 });
    await eA.attach('upload');
    await eB.attach('discard');
    expect(eB.status.realtime).toBe('connected');
    await addCompletion({ jobId: 'job-baker' }, A);
    await settle();
    await eA.syncNow();
    await vi.waitFor(async () => expect(await B.completions.count()).toBe(1));
  });
});

describe('v0.3.0 新欄位同步', () => {
  it('護照、門票價格表、入園門票、twdCategory、passportBonus 在兩支手機間往返不遺失', async () => {
    const { A, B, eA, eB } = await twoDevices();
    await saveChild({ name: '小明', birthday: '2020-03-15' }, A);
    const p = await savePassport({ issuedOn: '2026-01-10' }, A);
    await saveTicketPrices({ adult: 650 }, '2026-12-01', A);
    const v = await createVisit({ visitDate: '2026-11-28' }, A);
    await saveVisitTickets(v.id, [{ type: 'custom', label: '團體票', qty: 3, listPrice: 1400, paidPrice: 1200, note: '幼兒園' }], A);
    const { entries } = await addCompletion({ jobId: 'job-vet', visitId: v.id, completedAt: new Date(2026, 10, 28, 10).getTime(), applyPassportPerk: true }, A);
    await settle();
    await eA.syncNow();
    await eB.syncNow();

    const child = await B.child.get('kid');
    expect(child!.passport).toEqual(p);
    expect(child!.ticketPrices!.prices.adult).toBe(650);
    expect((await B.visits.get(v.id))!.tickets).toEqual([{ type: 'custom', label: '團體票', qty: 3, listPrice: 1400, paidPrice: 1200, note: '幼兒園' }]);
    expect(await B.ledger.get(p.feeEntryId!)).toMatchObject({ twdCategory: 'passport', amount: -399 });
    expect(await B.ledger.get(entries[0]!.id)).toMatchObject({ amount: 12, passportBonus: 2 });

    // B 升級、A 收到
    await recordUpgrade('2026-12-05', B);
    await settle();
    await eB.syncNow();
    await eA.syncNow();
    expect((await A.child.get('kid'))!.passport!.upgrades).toEqual([{ level: 'outstanding', date: '2026-12-05' }]);
  });
});

describe('刪除與還原', () => {
  it('軟刪除會套用到另一支手機，並出現在「最近刪除」（含照片與帳）', async () => {
    const { remote, A, B, eA, eB } = await twoDevices();
    const v = await createVisit({}, A);
    const { completion } = await addCompletion({ jobId: 'job-vet', visitId: v.id, photo: photo() }, A);
    await settle();
    await eA.syncNow();
    await eB.syncNow();
    await deleteCompletion(completion.id, {}, A);
    await settle();
    await eA.syncNow();
    expect(remote.get(FID, 'completions', completion.id)?.deleted).toBe(true);
    expect(remote.count(FID, 'completions', true)).toBe(1); // 軟刪除：雲端仍保留

    await eB.syncNow();
    expect(await B.completions.get(completion.id)).toBeUndefined();
    expect(await B.blobs.get(completion.photoBlobId!)).toBeUndefined();
    const trash = await B.trash.get(`completions:${completion.id}`);
    expect(trash?.label).toBe('動物醫師');
    expect(trash!.items.map((i) => i.tbl).sort()).toEqual(['blobs', 'blobs', 'completions', 'ledger']);
    expect(await A.trash.count()).toBe(1);
  });

  it('刪除優先：另一支手機較晚送達的舊編輯不會讓紀錄復活，且該手機會收到刪除', async () => {
    const { remote, A, B, eA, eB } = await twoDevices();
    const { completion } = await addCompletion({ jobId: 'job-vet', note: '原本' }, A);
    await settle();
    await eA.syncNow();
    await eB.syncNow();
    remote.offline = true; // B 在園區離線時改了備註
    await updateCompletion(completion.id, { note: 'B 離線修改' }, B);
    await settle();
    await eB.syncNow();
    remote.offline = false;
    await deleteCompletion(completion.id, {}, A); // A 在這期間刪掉
    await settle();
    await eA.syncNow();

    await eB.syncNow(); // B 的舊編輯晚到
    expect(remote.get(FID, 'completions', completion.id)?.deleted).toBe(true);
    expect(await B.completions.get(completion.id)).toBeUndefined();
    expect(await B.trash.get(`completions:${completion.id}`)).toBeDefined();
    await eA.syncNow();
    expect(await A.completions.get(completion.id)).toBeUndefined();
  });

  it('按「還原」後兩支手機都回來（含照片與帳）；離線時不能還原', async () => {
    const { remote, A, B, eA, eB } = await twoDevices();
    const v = await createVisit({}, A);
    const { completion } = await addCompletion({ jobId: 'job-vet', visitId: v.id, photo: photo('r') }, A);
    await settle();
    await eA.syncNow();
    await eB.syncNow();
    await deleteCompletion(completion.id, {}, A);
    await settle();
    await eA.syncNow();
    await eB.syncNow();

    remote.offline = true;
    await expect(eB.restore(`completions:${completion.id}`)).rejects.toMatchObject({ code: 'network' });
    remote.offline = false;

    await eB.restore(`completions:${completion.id}`); // B 還原（B 的最近刪除來自雲端推送）
    expect(remote.get(FID, 'completions', completion.id)?.deleted).toBe(false);
    expect(await B.completions.get(completion.id)).toBeDefined();
    expect(await B.trash.count()).toBe(0);
    await eA.syncNow();
    expect(await A.completions.get(completion.id)).toBeDefined();
    expect(await A.ledger.where('completionId').equals(completion.id).count()).toBe(1);
    expect(await (await A.blobs.get(completion.thumbBlobId!))!.data!.text()).toBe('thumb-r');
    expect(await A.trash.count()).toBe(0); // 拉到還原後，A 的最近刪除也清掉
  });

  it('本機模式（未加入家庭）也能還原', async () => {
    const d = device();
    const { completion } = await addCompletion({ jobId: 'job-vet', photo: photo() }, d);
    await deleteCompletion(completion.id, {}, d);
    expect(await d.completions.count()).toBe(0);
    await restoreTrashLocal(`completions:${completion.id}`, d);
    expect(await d.completions.count()).toBe(1);
    expect(await d.blobs.count()).toBe(2);
  });
});

describe('首次登入與遷移', () => {
  it('建立家庭：本機全部資料（含照片）上傳，回報照片進度；官方地圖不上傳', async () => {
    const remote = new MemoryRemoteStore();
    const A = device();
    await saveChild({ name: '小明', birthday: '2020-03-15' }, A);
    const v = await createVisit({}, A);
    for (const job of ['job-vet', 'job-police']) await addCompletion({ jobId: job, visitId: v.id, photo: photo(job) }, A);
    await saveOfficialMap(1, jpeg('map'), A);
    const eA = engine(A, remote);
    const progress: number[] = [];
    eA.subscribe((s) => s.progress && progress.push(s.progress.done));
    await eA.attach('upload');
    expect(remote.count(FID, 'completions')).toBe(2);
    expect(remote.count(FID, 'child')).toBe(1);
    expect(remote.count(FID, 'blobs')).toBe(4);
    expect(remote.photos.size).toBe(4);
    expect(Math.max(...progress)).toBe(4);
    expect([...remote.photos.keys()].every((k) => !k.includes('map'))).toBe(true);
    expect(await getSyncState(A, 'familyId')).toBe(FID);
  });

  it('加入家庭－合併：本機紀錄上傳、家庭紀錄下載；孩子資料以家庭為準', async () => {
    const remote = new MemoryRemoteStore();
    const A = device();
    await saveChild({ name: '家庭版', birthday: '2020-03-15' }, A);
    await addCompletion({ jobId: 'job-vet' }, A);
    await engine(A, remote).attach('upload');

    const B = device();
    await saveChild({ name: '本機版', birthday: '2021-01-01' }, B);
    await addCompletion({ jobId: 'job-police' }, B);
    expect(await localDataCount(B)).toBeGreaterThan(0);
    await engine(B, remote).attach('merge');
    expect((await B.child.get('kid'))!.name).toBe('家庭版');
    expect((await B.completions.toArray()).map((c) => c.jobId).sort()).toEqual(['job-police', 'job-vet']);
    expect(remote.count(FID, 'completions')).toBe(2);
    expect((remote.get(FID, 'child', 'kid')!.data as { name: string }).name).toBe('家庭版');
  });

  it('加入家庭－捨棄：清掉本機紀錄後改用家庭資料；本機官方地圖與設定保留', async () => {
    const remote = new MemoryRemoteStore();
    const A = device();
    await addCompletion({ jobId: 'job-vet' }, A);
    await engine(A, remote).attach('upload');

    const B = device();
    await addCompletion({ jobId: 'job-police' }, B);
    await saveOfficialMap(2, jpeg('map'), B);
    await setSetting('soundOn', false, B);
    await engine(B, remote).attach('discard');
    expect((await B.completions.toArray()).map((c) => c.jobId)).toEqual(['job-vet']);
    expect(await B.blobs.where('kind').equals('official-map').count()).toBe(1);
    expect((await B.settings.get('soundOn'))?.value).toBe(false);
    expect(remote.count(FID, 'completions')).toBe(1);
  });

  it('登出並清除本機快取：保留設定與官方地圖；重新開機不再記錄 outbox', async () => {
    const { A } = await twoDevices();
    await addCompletion({ jobId: 'job-vet' }, A);
    await saveOfficialMap(1, jpeg('map'), A);
    await setSetting('soundOn', false, A);
    await clearSyncedLocalData(A);
    expect(await A.completions.count()).toBe(0);
    expect(await A.blobs.count()).toBe(1);
    expect(await A.settings.count()).toBe(2); // soundOn ＋ officialMap1F
    expect(await loadSyncFamily(A)).toBeNull();
    await addCompletion({ jobId: 'job-vet' }, A);
    await settle();
    expect(await A.outbox.count()).toBe(0);
  });
});

describe('離線與暫停偵測', () => {
  it('手機有網路但雲端連續失敗 24 小時 → 「雲端可能已暫停」；恢復後清除', async () => {
    let now = Date.UTC(2026, 10, 27);
    let online = true;
    const remote = new MemoryRemoteStore();
    const A = device();
    const eA = engine(A, remote, { now: () => now, online: () => online });
    await eA.attach('upload');
    remote.offline = true;
    await eA.syncNow();
    expect(eA.status.phase).toBe('offline');
    now += PAUSE_AFTER_MS - 60_000;
    await eA.syncNow();
    expect(eA.status.phase).toBe('offline');
    now += 120_000;
    await eA.syncNow();
    expect(eA.status.phase).toBe('paused');

    online = false; // 手機自己沒網路：不算暫停
    await eA.syncNow();
    expect(eA.status.phase).toBe('offline');

    online = true;
    remote.offline = false;
    await eA.syncNow();
    expect(eA.status.phase).toBe('synced');
    expect(await getSyncState(A, 'firstFailAt')).toBeNull();
  });

  it('手機一直沒網路（飛航模式）不會被判定為暫停', async () => {
    let now = 0;
    const remote = new MemoryRemoteStore();
    const A = device();
    const eA = engine(A, remote, { now: () => now, online: () => false });
    await eA.attach('upload');
    remote.offline = true;
    await eA.syncNow();
    now += 3 * PAUSE_AFTER_MS;
    await eA.syncNow();
    expect(eA.status.phase).toBe('offline');
  });

  it('退避時間 5 秒起倍增，最長 5 分鐘', async () => {
    const remote = new MemoryRemoteStore();
    const A = device();
    const eA = engine(A, remote);
    await eA.attach('upload');
    remote.offline = true;
    const seen: number[] = [];
    for (let i = 0; i < 9; i++) {
      await eA.syncNow();
      seen.push(eA.backoffMs);
    }
    expect(seen).toEqual([5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000, 300000]);
  });

  it('非網路錯誤顯示「同步失敗」', async () => {
    const remote = new MemoryRemoteStore();
    const A = device();
    const eA = engine(A, remote);
    await eA.attach('upload');
    await addCompletion({ jobId: 'job-vet' }, A);
    await settle();
    remote.failNext('upsert', 'unknown');
    await eA.syncNow();
    expect(eA.status.phase).toBe('error');
    expect(await A.outbox.count()).toBe(2);
  });
});

describe('2026-11-27 同步細節修正', () => {
  it('upsert 讀回：舊編輯被「刪除優先」擋下時，推送當下就套用刪除並結束，不再重試', async () => {
    const { remote, A, B, eA, eB } = await twoDevices();
    const { completion } = await addCompletion({ jobId: 'job-vet' }, A);
    await settle();
    await eA.syncNow();
    await eB.syncNow();
    remote.offline = true;
    await updateCompletion(completion.id, { note: 'B 的舊編輯' }, B);
    await settle();
    await eB.syncNow();
    remote.offline = false;
    await deleteCompletion(completion.id, {}, A);
    await settle();
    await eA.syncNow();

    await eB.push(); // 只推送、不拉取
    expect(await B.completions.get(completion.id)).toBeUndefined();
    expect(await B.outbox.count()).toBe(0);
    expect(await B.trash.get(`completions:${completion.id}`)).toBeDefined();
    const before = remote.upsertBatches.length;
    await eB.syncNow();
    expect(remote.upsertBatches.length).toBe(before); // 沒有東西要再送
  });

  it('首次上傳本機資料用批次 upsert（每批最多 100 筆）', async () => {
    const remote = new MemoryRemoteStore();
    const A = device();
    const v = await createVisit({}, A);
    await addCompletion({ jobId: 'job-vet', visitId: v.id, photo: photo() }, A);
    for (let i = 0; i < 120; i++) await addManualEntry({ visitId: v.id, type: 'adjust', amount: 1 }, A);
    await engine(A, remote).attach('upload');
    // 1 入園＋1 起始資金＋1 紀錄＋1 賺得＋2 照片中繼資料＋120 筆手動帳 = 126 筆 → 2 批
    expect(remote.upsertBatches).toEqual([100, 26]);
    expect(remote.count(FID)).toBe(126);
  });

  it('照片上傳成功但紀錄寫入失敗：照片不重傳、outbox 保留；重試後補寫紀錄', async () => {
    const remote = new MemoryRemoteStore();
    const A = device();
    const eA = engine(A, remote);
    await eA.attach('upload');
    const { completion } = await addCompletion({ jobId: 'job-vet', photo: photo('x') }, A);
    await settle();
    remote.failNext('upsert');
    await eA.syncNow();
    expect(eA.status.phase).toBe('offline');
    expect(remote.photos.size).toBe(2); // 照片已在 Storage
    expect(remote.get(FID, 'blobs', completion.photoBlobId!)).toBeUndefined(); // 中繼資料還沒寫
    expect(remote.get(FID, 'completions', completion.id)).toBeUndefined();
    expect((await A.blobs.get(completion.photoBlobId!))!.uploaded).toBe(true);
    expect(await A.outbox.count()).toBeGreaterThan(0);

    const uploadsBefore = remote.calls.filter((c) => c === 'upload').length;
    await eA.syncNow();
    expect(eA.status.phase).toBe('synced');
    expect(remote.calls.filter((c) => c === 'upload').length).toBe(uploadsBefore); // 不重傳
    expect(remote.get(FID, 'blobs', completion.photoBlobId!)?.data).toMatchObject({ kind: 'photo' });
    expect(remote.get(FID, 'completions', completion.id)).toBeDefined();
    expect(await A.outbox.count()).toBe(0);
  });

  it('pull 往回重疊 5 秒（游標 − 5 秒）', async () => {
    const { remote, A, eA } = await twoDevices();
    await addCompletion({ jobId: 'job-vet' }, A);
    await settle();
    await eA.syncNow();
    const cursor = (await getSyncState<string>(A, 'cursor'))!;
    const spy = vi.spyOn(remote, 'pullSince');
    await eA.pull();
    const since = spy.mock.calls[0]![1]!;
    expect(new Date(cursor).getTime() - new Date(since).getTime()).toBe(5000);
  });

  it('Realtime 重連時補一次 pull', async () => {
    const remote = new MemoryRemoteStore();
    const A = device();
    const eA = engine(A, remote, { autoSchedule: true, debounceMs: 0 });
    await eA.attach('upload');
    await vi.waitFor(() => expect(eA.status.phase).toBe('synced'));
    const pulls = () => remote.calls.filter((c) => c === 'pull').length;
    await vi.waitFor(() => expect(eA.status.phase).toBe('synced'));
    const before = pulls();
    remote.emitStatus('disconnected');
    expect(eA.status.realtime).toBe('disconnected');
    remote.emitStatus('connected');
    await vi.waitFor(() => expect(pulls()).toBeGreaterThan(before));
  });

  it('Realtime 以登入後的 session 訂閱：先 setAuth(使用者 token) 再加入頻道；沒有 session 不訂閱', async () => {
    const order: string[] = [];
    const chan = {
      on: vi.fn(() => chan),
      subscribe: vi.fn((cb: (s: string) => void) => {
        order.push('subscribe');
        cb('SUBSCRIBED');
        return chan;
      }),
    };
    let session: { access_token: string } | null = { access_token: 'user-session-jwt' };
    const sb = {
      auth: { getSession: vi.fn(async () => ({ data: { session } })) },
      realtime: { setAuth: vi.fn(async (t: string) => void order.push(`setAuth:${t}`)) },
      channel: vi.fn(() => {
        order.push('channel');
        return chan;
      }),
      removeChannel: vi.fn(async () => 'ok'),
    } as unknown as SupabaseClient;
    const store = SupabaseRemoteStore.fromClient(sb);
    const statuses: string[] = [];
    const unsub = store.subscribe(FID, () => undefined, (s) => statuses.push(s));
    await vi.waitFor(() => expect(statuses).toEqual(['connected']));
    expect(order).toEqual(['setAuth:user-session-jwt', 'channel', 'subscribe']);
    expect(chan.on).toHaveBeenCalledWith('postgres_changes', expect.objectContaining({ table: 'records', filter: `family_id=eq.${FID}` }), expect.any(Function));
    unsub();
    expect(sb.removeChannel).toHaveBeenCalled();

    session = null;
    order.length = 0;
    const statuses2: string[] = [];
    store.subscribe(FID, () => undefined, (s) => statuses2.push(s));
    await vi.waitFor(() => expect(statuses2).toEqual(['disconnected']));
    expect(order).toEqual([]);
  });
});
