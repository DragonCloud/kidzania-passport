import { db, newId, type AppDB } from '../db/db';
import type { Completion, LedgerEntry, StoredBlob, TrashEntry } from '../types/models';
import { jobById } from './jobs';
import { autoEntriesForJob, sumKidzos } from './ledger';
import { isPassportValidOn, levelOn } from './passport';
import { localDateISO } from './format';

export interface PhotoPair {
  full: Blob;
  thumb: Blob;
}

export interface AddCompletionInput {
  jobId: string;
  completedAt?: number;
  visitId?: string;
  photo?: PhotoPair;
  note?: string;
  /** 依表定 kidZos 自動記帳（預設 true；餘額不足時 UI 可讓使用者選擇只蓋章不扣） */
  chargeKidzos?: boolean;
  /** 依表定新臺幣自動記一筆自費（預設 true） */
  recordTwd?: boolean;
  /** 依蓋章當天的護照等級套用加碼／減免（預設 false；蓋章頁預設開啟） */
  applyPassportPerk?: boolean;
}

export interface BalanceCheck {
  balance: number | null;
  delta: number;
  insufficient: boolean;
}

/** 蓋章前檢查：這次入園的餘額夠不夠付 */
export async function checkBalance(jobId: string, visitId: string | undefined, d: AppDB = db): Promise<BalanceCheck> {
  const job = jobById(jobId);
  const delta = job?.kidzoDelta ?? 0;
  if (!visitId) return { balance: null, delta, insufficient: false };
  const balance = sumKidzos(await d.ledger.where('visitId').equals(visitId).toArray());
  return { balance, delta, insufficient: delta < 0 && balance + delta < 0 };
}

function photoBlobs(photo: PhotoPair): { full: StoredBlob; thumb: StoredBlob } {
  const now = Date.now();
  return {
    full: { id: newId(), kind: 'photo', mime: photo.full.type || 'image/jpeg', data: photo.full, createdAt: now },
    thumb: { id: newId(), kind: 'thumb', mime: photo.thumb.type || 'image/jpeg', data: photo.thumb, createdAt: now },
  };
}

/** 某個時間點有效的護照等級（無護照、未辦理或已過期 → null） */
export async function passportLevelAt(at: number, d: AppDB = db) {
  const child = await d.child.get('kid');
  const day = localDateISO(at);
  if (!child?.passport || !isPassportValidOn(child.passport, child.birthday, day)) return null;
  return levelOn(child.passport, day);
}

export async function addCompletion(
  input: AddCompletionInput,
  d: AppDB = db,
): Promise<{ completion: Completion; entries: LedgerEntry[] }> {
  const job = jobById(input.jobId);
  if (!job) throw new Error(`找不到職業：${input.jobId}`);
  const at = input.completedAt ?? Date.now();
  const completion: Completion = {
    id: newId(),
    jobId: job.id,
    visitId: input.visitId,
    completedAt: at,
    note: input.note?.trim() || undefined,
  };
  const perkLevel = input.applyPassportPerk ? await passportLevelAt(at, d) : null;
  const entries = autoEntriesForJob(
    job,
    { completionId: completion.id, visitId: input.visitId, at },
    { chargeKidzos: input.chargeKidzos, recordTwd: input.recordTwd, perkLevel },
  );
  await d.transaction('rw', [d.completions, d.ledger, d.blobs, d.outbox], async () => {
    if (input.photo) {
      const { full, thumb } = photoBlobs(input.photo);
      await d.blobs.bulkAdd([full, thumb]);
      completion.photoBlobId = full.id;
      completion.thumbBlobId = thumb.id;
    }
    await d.completions.add(completion);
    if (entries.length) await d.ledger.bulkAdd(entries);
  });
  return { completion, entries };
}

export interface UpdateCompletionPatch {
  completedAt?: number;
  /** null＝解除與入園紀錄的關聯 */
  visitId?: string | null;
  note?: string;
  /** PhotoPair＝換照片；null＝移除照片；undefined＝不變 */
  photo?: PhotoPair | null;
}

/** 修改完成紀錄；時間與入園關聯會同步到它自動產生的帳 */
export async function updateCompletion(id: string, patch: UpdateCompletionPatch, d: AppDB = db): Promise<void> {
  await d.transaction('rw', [d.completions, d.ledger, d.blobs, d.outbox], async () => {
    const c = await d.completions.get(id);
    if (!c) throw new Error('找不到這筆完成紀錄');
    const next: Completion = { ...c };
    if (patch.completedAt !== undefined) next.completedAt = patch.completedAt;
    if (patch.visitId !== undefined) next.visitId = patch.visitId ?? undefined;
    if (patch.note !== undefined) next.note = patch.note.trim() || undefined;
    if (patch.photo !== undefined) {
      const old = [c.photoBlobId, c.thumbBlobId].filter((x): x is string => !!x);
      if (old.length) await d.blobs.bulkDelete(old);
      next.photoBlobId = undefined;
      next.thumbBlobId = undefined;
      if (patch.photo) {
        const { full, thumb } = photoBlobs(patch.photo);
        await d.blobs.bulkAdd([full, thumb]);
        next.photoBlobId = full.id;
        next.thumbBlobId = thumb.id;
      }
    }
    await d.completions.put(next);
    if (patch.completedAt !== undefined || patch.visitId !== undefined) {
      const linked = await d.ledger.where('completionId').equals(id).toArray();
      for (const e of linked) await d.ledger.put({ ...e, at: next.completedAt, visitId: next.visitId });
    }
  });
}

/**
 * 刪除完成紀錄與照片；預設一起刪除它自動產生的帳。
 * 刪除前把內容放進「最近刪除」（30 天內可還原；家庭同步時雲端也是軟刪除）。
 */
export async function deleteCompletion(id: string, opts: { keepLedger?: boolean } = {}, d: AppDB = db): Promise<void> {
  await d.transaction('rw', [d.completions, d.ledger, d.blobs, d.outbox, d.trash], async () => {
    const c = await d.completions.get(id);
    if (!c) return;
    const blobIds = [c.photoBlobId, c.thumbBlobId].filter((x): x is string => !!x);
    const blobs = (await d.blobs.bulkGet(blobIds)).filter((b): b is NonNullable<typeof b> => !!b);
    const linked = await d.ledger.where('completionId').equals(id).toArray();
    const trashed: TrashEntry = {
      key: `completions:${id}`,
      label: jobById(c.jobId)?.nameZh ?? '職業體驗',
      jobId: c.jobId,
      deletedAt: Date.now(),
      items: [
        { tbl: 'completions', id: c.id, data: c },
        ...blobs.map((b) => ({ tbl: 'blobs' as const, id: b.id, data: b })),
        ...(opts.keepLedger ? [] : linked.map((e) => ({ tbl: 'ledger' as const, id: e.id, data: e }))),
      ],
    };
    await d.trash.put(trashed);
    if (blobIds.length) await d.blobs.bulkDelete(blobIds);
    if (opts.keepLedger) {
      for (const e of linked) await d.ledger.put({ ...e, completionId: undefined });
    } else {
      await d.ledger.bulkDelete(linked.map((e) => e.id));
    }
    await d.completions.delete(id);
  });
}

export interface JobStats {
  count: number;
  lastAt: number;
}

/** jobId → 完成次數與最近一次時間 */
export function statsByJob(completions: Completion[]): Map<string, JobStats> {
  const m = new Map<string, JobStats>();
  for (const c of completions) {
    const s = m.get(c.jobId);
    if (s) {
      s.count += 1;
      s.lastAt = Math.max(s.lastAt, c.completedAt);
    } else m.set(c.jobId, { count: 1, lastAt: c.completedAt });
  }
  return m;
}
