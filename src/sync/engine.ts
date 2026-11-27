import type { Table } from 'dexie';
import { syncTable, type AppDB } from '../db/db';
import { jobById } from '../lib/jobs';
import { SYNC_TABLES, type Completion, type OutboxEntry, type StoredBlob, type SyncStateKey, type SyncTable, type TrashEntry } from '../types/models';
import { SyncError } from './errors';
import { nextSeq, runAsRemote, snapshotOf, syncRuntime } from './hooks';
import { photoPath, type RealtimeStatus, type RemoteRecord, type RemoteRecordInput, type RemoteStore } from './remote';

/**
 * 離線優先的同步引擎。Dexie 仍是 UI 唯一資料來源。
 * - 推送：outbox 依 seq 批次 upsert；照片先上傳 Storage 再寫中繼資料；成功才移除（期間又改過的保留）
 * - 拉取：updated_at 游標往前重疊 5 秒；另訂閱 Realtime，收到即套用
 * - 套用：outbox 有待送 → 略過；deleted → 本機刪除（放進最近刪除）；否則覆蓋（伺服器最後寫入者勝）
 * - 失敗：網路／5xx 視為離線，指數退避 5 秒 → 5 分鐘；裝置有網路卻連續失敗 24 小時 → 「雲端可能已暫停」
 */
export type SyncPhase = 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'paused';

export interface SyncStatus {
  phase: SyncPhase;
  lastSyncAt: number | null;
  error: string | null;
  /** 照片上傳進度（首次上傳或大量照片時） */
  progress: { done: number; total: number } | null;
  realtime: RealtimeStatus;
}

export interface EngineOptions {
  now?: () => number;
  /** 裝置是否有網路（navigator.onLine） */
  online?: () => boolean;
  /** 上傳前壓縮照片（> 1.5 MB 再壓一次） */
  compress?: (b: Blob) => Promise<Blob>;
  /** 自動排程（app 用 true；測試手動呼叫 syncNow） */
  autoSchedule?: boolean;
  debounceMs?: number;
}

export type AttachMode = 'upload' | 'merge' | 'discard' | 'resume';

const PAGE = 500;
const OVERLAP_MS = 5000;
const BACKOFF_MIN = 5_000;
const BACKOFF_MAX = 5 * 60_000;
export const PAUSE_AFTER_MS = 24 * 60 * 60_000;
const POLL_MS = 60_000;
export const TRASH_KEEP_MS = 30 * 86_400_000;

export async function getSyncState<T>(d: AppDB, key: SyncStateKey): Promise<T | null> {
  return ((await d.syncState.get(key))?.value as T | undefined) ?? null;
}
export async function setSyncState(d: AppDB, key: SyncStateKey, value: unknown): Promise<void> {
  if (value === null || value === undefined) await d.syncState.delete(key);
  else await d.syncState.put({ key, value });
}

/** 開機時讀回 familyId，讓 hooks 立即開始記錄（不必等帳號狀態讀完） */
export async function loadSyncFamily(d: AppDB): Promise<string | null> {
  const fid = await getSyncState<string>(d, 'familyId');
  syncRuntime(d).familyId = fid;
  return fid;
}

/** 本機是否已有會同步的資料（決定加入家庭時要不要問「合併／捨棄」） */
export async function localDataCount(d: AppDB): Promise<number> {
  const [v, c, l, child] = await Promise.all([d.visits.count(), d.completions.count(), d.ledger.count(), d.child.get('kid')]);
  return v + c + l + (child?.birthday ? 1 : 0);
}

/** 清除會同步的本機資料（保留 settings 與本機官方地圖）：登出、捨棄本機時使用 */
export async function clearSyncedLocalData(d: AppDB): Promise<void> {
  await runAsRemote(d, [d.child, d.visits, d.completions, d.ledger, d.blobs, d.outbox, d.syncState, d.trash], async () => {
    await Promise.all([d.child.clear(), d.visits.clear(), d.completions.clear(), d.ledger.clear(), d.outbox.clear(), d.syncState.clear(), d.trash.clear()]);
    await d.blobs.filter((b) => b.kind !== 'official-map').delete();
  });
  syncRuntime(d).familyId = null;
}

/** 本機資料 → 雲端 data */
export function toRemoteData(tbl: SyncTable, row: unknown, familyId: string): unknown {
  if (tbl === 'blobs') {
    const meta = snapshotOf('blobs', row) as Record<string, unknown>;
    return { id: meta.id, kind: meta.kind, mime: meta.mime, createdAt: meta.createdAt, path: photoPath(familyId, String(meta.id)) };
  }
  return row;
}

function tableList(d: AppDB): Table[] {
  return [d.child, d.visits, d.completions, d.ledger, d.blobs, d.outbox, d.trash];
}

function isoMinus(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() - ms).toISOString();
}

export class SyncEngine {
  status: SyncStatus = { phase: 'idle', lastSyncAt: null, error: null, progress: null, realtime: 'disconnected' };
  private listeners = new Set<(s: SyncStatus) => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeRealtime: (() => void) | null = null;
  private cleanups: (() => void)[] = [];
  private downloading = new Map<string, Promise<void>>();
  private readonly now: () => number;
  private readonly online: () => boolean;
  private readonly compress: (b: Blob) => Promise<Blob>;

  constructor(
    readonly d: AppDB,
    readonly remote: RemoteStore,
    readonly familyId: string,
    private readonly opts: EngineOptions = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.online = opts.online ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
    this.compress = opts.compress ?? (async (b) => b);
  }

  // ───────── 狀態 ─────────

  subscribe(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }

  // ───────── 生命週期 ─────────

  /** 連上家庭並開始同步 */
  async attach(mode: AttachMode): Promise<void> {
    const { d } = this;
    const prev = await getSyncState<string>(d, 'familyId');
    if (prev && prev !== this.familyId) {
      // 換了家庭：舊家庭的待送與游標都不再適用
      await clearSyncedLocalData(d);
    }
    if (mode === 'discard') {
      await clearSyncedLocalData(d);
    }
    await setSyncState(d, 'familyId', this.familyId);
    syncRuntime(d).familyId = this.familyId;
    this.status.lastSyncAt = await getSyncState<number>(d, 'lastSyncAt');

    if (mode === 'upload') {
      await this.enqueueAll(new Set());
    } else if (mode === 'merge') {
      // 先拉家庭資料（孩子資料以家庭為準），再把本機其餘紀錄排入上傳
      const fromRemote = new Set<string>();
      try {
        await this.pull(fromRemote);
      } catch {
        /* 離線時稍後再拉；本機紀錄照樣排入 */
      }
      const skip = new Set(fromRemote);
      if (await d.child.get('kid')) {
        const remoteChild = fromRemote.has('child:kid');
        if (remoteChild) skip.add('child:kid');
      }
      await this.enqueueAll(skip);
    }

    syncRuntime(d).onLocalChange = () => this.schedule(this.opts.debounceMs ?? 2000);
    if (this.opts.autoSchedule) this.startScheduling();
    await this.syncNow();
  }

  stop(): void {
    this.stopped = true;
    const rt = syncRuntime(this.d);
    rt.onLocalChange = undefined;
    this.unsubscribeRealtime?.();
    this.unsubscribeRealtime = null;
    for (const c of this.cleanups) c();
    this.cleanups = [];
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.listeners.clear();
  }

  /** 把本機所有會同步的資料排入 outbox（官方地圖除外） */
  private async enqueueAll(skip: Set<string>): Promise<number> {
    const { d } = this;
    let n = 0;
    await d.transaction('rw', [d.outbox, ...SYNC_TABLES.map((t) => syncTable(d, t))], async () => {
      for (const tbl of SYNC_TABLES) {
        const rows = await syncTable(d, tbl).toArray();
        for (const row of rows) {
          if (tbl === 'blobs' && (row as unknown as StoredBlob).kind === 'official-map') continue;
          if (skip.has(`${tbl}:${row.id}`)) continue;
          await d.outbox.put({ tbl, rowId: row.id, op: 'put', seq: nextSeq(), queuedAt: this.now() });
          n += 1;
        }
      }
    });
    return n;
  }

  private startScheduling() {
    this.unsubscribeRealtime = this.remote.subscribe(
      this.familyId,
      (r) => {
        void this.applyRemote([r]).then(() => this.schedule(1000));
      },
      (s) => {
        this.setStatus({ realtime: s });
        if (s === 'connected') this.schedule(0); // 重連後補做一次增量拉取
      },
    );
    if (typeof window !== 'undefined') {
      const onOnline = () => this.schedule(0);
      const onVisible = () => document.visibilityState === 'visible' && this.schedule(0);
      window.addEventListener('online', onOnline);
      document.addEventListener('visibilitychange', onVisible);
      this.cleanups.push(() => window.removeEventListener('online', onOnline), () => document.removeEventListener('visibilitychange', onVisible));
    }
    // Realtime 斷線時的保底輪詢
    this.pollTimer = setInterval(() => {
      if (this.status.realtime !== 'connected' && (typeof document === 'undefined' || document.visibilityState === 'visible')) this.schedule(0);
    }, POLL_MS);
  }

  /** 延遲後同步（寫入後 debounce、事件觸發） */
  schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.syncNow(), delayMs);
  }

  // ───────── 同步一次：先推後拉 ─────────

  syncNow(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.runOnce();
      } while (this.again && !this.stopped);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runOnce(): Promise<void> {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.setStatus({ phase: 'syncing' });
    try {
      await this.push();
      await this.pull();
      await this.downloadMissingThumbs();
      await this.purgeTrash();
      this.failures = 0;
      const t = this.now();
      await setSyncState(this.d, 'firstFailAt', null);
      await setSyncState(this.d, 'lastSyncAt', t);
      await setSyncState(this.d, 'lastError', null);
      this.setStatus({ phase: 'synced', lastSyncAt: t, error: null, progress: null });
    } catch (e) {
      await this.onFailure(e);
    }
  }

  private async onFailure(e: unknown) {
    const err = e instanceof SyncError ? e : new SyncError('unknown', String(e));
    this.failures += 1;
    const delay = Math.min(BACKOFF_MIN * 2 ** (this.failures - 1), BACKOFF_MAX);
    if (err.code === 'network') {
      let first = await getSyncState<number>(this.d, 'firstFailAt');
      // 只有「手機有網路卻連不上」才計入暫停判斷（飛航模式不算）
      if (this.online() && first === null) {
        first = this.now();
        await setSyncState(this.d, 'firstFailAt', first);
      }
      const paused = this.online() && first !== null && this.now() - first >= PAUSE_AFTER_MS;
      this.setStatus({ phase: paused ? 'paused' : 'offline', error: null, progress: null });
    } else {
      await setSyncState(this.d, 'lastError', err.message);
      this.setStatus({ phase: 'error', error: err.detail ? `${err.message}（${err.detail}）` : err.message, progress: null });
    }
    if (!this.stopped && this.opts.autoSchedule) {
      this.retryTimer = setTimeout(() => void this.syncNow(), delay);
    }
  }

  /** 目前退避等待時間（測試用） */
  get backoffMs(): number {
    return this.failures ? Math.min(BACKOFF_MIN * 2 ** (this.failures - 1), BACKOFF_MAX) : 0;
  }

  // ───────── 推送 ─────────

  async push(): Promise<void> {
    const { d, familyId } = this;
    const totalPhotos = await this.countPendingPhotos();
    let done = 0;
    if (totalPhotos > 0) this.setStatus({ progress: { done, total: totalPhotos } });
    for (;;) {
      const batch: OutboxEntry[] = await d.outbox.orderBy('seq').limit(100).toArray();
      if (!batch.length) break;
      const rows: RemoteRecordInput[] = [];
      for (const e of batch) {
        if (e.op === 'delete') {
          rows.push({ tbl: e.tbl, id: e.rowId, data: e.snapshot ? toRemoteData(e.tbl, e.snapshot, familyId) : {}, deleted: true, client_updated_at: e.queuedAt });
          continue;
        }
        const row = await syncTable(d, e.tbl).get(e.rowId);
        if (!row) continue; // 已被刪除：之後的 delete 會處理
        if (e.tbl === 'blobs') {
          const b = row as unknown as StoredBlob;
          if (b.kind === 'official-map') continue;
          if (!b.uploaded) {
            if (!b.data) continue; // 沒有圖檔可上傳（理論上不會發生）
            const path = photoPath(familyId, b.id);
            await this.remote.uploadPhoto(path, await this.compress(b.data));
            await runAsRemote(d, [d.blobs], () => d.blobs.update(b.id, { uploaded: true, remotePath: path }));
            done += 1;
            if (totalPhotos > 0) this.setStatus({ progress: { done, total: totalPhotos } });
          }
        }
        rows.push({ tbl: e.tbl, id: e.rowId, data: toRemoteData(e.tbl, row, familyId), deleted: false, client_updated_at: e.queuedAt });
      }
      const saved = await this.remote.upsertRecords(familyId, rows);
      // 成功才移除；推送期間又被修改（seq 變了）的保留到下一輪
      await d.transaction('rw', d.outbox, async () => {
        for (const e of batch) {
          const cur = await d.outbox.get([e.tbl, e.rowId]);
          if (cur && cur.seq === e.seq) await d.outbox.delete([e.tbl, e.rowId]);
        }
      });
      // 刪除優先：送出「未刪除」卻讀回「已刪除」→ 這筆已完成（不再重試），立即套用伺服器的刪除
      const sentAlive = new Set(rows.filter((r) => !r.deleted).map((r) => `${r.tbl}:${r.id}`));
      const blocked = saved.filter((r) => r.deleted && sentAlive.has(`${r.tbl}:${r.id}`));
      if (blocked.length) await this.applyRemote(blocked);
    }
  }

  private async countPendingPhotos(): Promise<number> {
    const ids = (await this.d.outbox.toArray()).filter((e) => e.tbl === 'blobs' && e.op === 'put').map((e) => e.rowId);
    if (!ids.length) return 0;
    const blobs = await this.d.blobs.bulkGet(ids);
    return blobs.filter((b) => b && !b.uploaded && b.data && b.kind !== 'official-map').length;
  }

  // ───────── 拉取 ─────────

  async pull(collect?: Set<string>): Promise<void> {
    const { d } = this;
    const cursor = await getSyncState<string>(d, 'cursor');
    let since = cursor ? isoMinus(cursor, OVERLAP_MS) : null;
    let maxSeen = cursor;
    const seen = new Set<string>();
    for (;;) {
      const rows = await this.remote.pullSince(this.familyId, since, PAGE);
      const fresh = rows.filter((r) => !seen.has(`${r.tbl}:${r.id}@${r.updated_at}`));
      if (!fresh.length) break;
      for (const r of fresh) {
        seen.add(`${r.tbl}:${r.id}@${r.updated_at}`);
        collect?.add(`${r.tbl}:${r.id}`);
      }
      await this.applyRemote(fresh);
      const last = rows[rows.length - 1]!.updated_at;
      if (!maxSeen || last > maxSeen) {
        maxSeen = last;
        await setSyncState(d, 'cursor', maxSeen);
      }
      if (rows.length < PAGE) break;
      since = last;
    }
  }

  /** 套用雲端資料（不回送）。也被 Realtime 呼叫。 */
  async applyRemote(rows: RemoteRecord[]): Promise<void> {
    const { d } = this;
    const thumbs: string[] = [];
    await runAsRemote(d, tableList(d), async () => {
      for (const r of rows) {
        if (!SYNC_TABLES.includes(r.tbl)) continue;
        // 規則 1：本機有待送變更 → 略過（送出後伺服器會回推最終值）
        if (await d.outbox.get([r.tbl, r.id])) continue;
        const table = syncTable(d, r.tbl);
        const existing = await table.get(r.id);
        if (r.deleted) {
          if (existing) {
            await this.recordRemoteDeletion(r.tbl, existing);
            await table.delete(r.id);
          }
          continue;
        }
        const data = r.data as Record<string, unknown> | null;
        if (!data || typeof data !== 'object' || data.id !== r.id) continue;
        if (r.tbl === 'blobs') {
          const prev = existing as unknown as StoredBlob | undefined;
          const meta = data as { kind: StoredBlob['kind']; mime: string; createdAt: number; path: string };
          if (meta.kind === 'official-map') continue;
          const next: StoredBlob = { id: r.id, kind: meta.kind, mime: meta.mime, createdAt: meta.createdAt, remotePath: meta.path, uploaded: true, data: prev?.data };
          await d.blobs.put(next);
          if (next.kind === 'thumb' && !next.data) thumbs.push(r.id);
        } else {
          await table.put(data as { id: string } & Record<string, unknown>);
        }
        // 已還原：從最近刪除移除
        if (r.tbl === 'completions') await d.trash.delete(`completions:${r.id}`);
      }
    });
    if (thumbs.length) void this.downloadMissingThumbs();
  }

  /** 雲端傳來刪除：把本機內容放進「最近刪除」，30 天內可還原 */
  private async recordRemoteDeletion(tbl: SyncTable, row: { id: string } & Record<string, unknown>) {
    const { d } = this;
    const at = this.now();
    if (tbl === 'completions') {
      const c = row as unknown as Completion;
      const key = `completions:${c.id}`;
      const prev = await d.trash.get(key);
      const items = (prev?.items ?? []).filter((i) => !(i.tbl === 'completions' && i.id === c.id));
      await d.trash.put({ key, label: jobById(c.jobId)?.nameZh ?? '職業體驗', jobId: c.jobId, deletedAt: at, items: [{ tbl, id: c.id, data: row }, ...items] });
    } else if (tbl === 'ledger' && typeof row.completionId === 'string') {
      await this.addToTrash(`completions:${row.completionId}`, { tbl, id: row.id, data: row });
    } else if (tbl === 'blobs') {
      const entries = await d.trash.toArray();
      const owner = entries.find((t) =>
        t.items.some((i) => i.tbl === 'completions' && ((i.data as Completion).photoBlobId === row.id || (i.data as Completion).thumbBlobId === row.id)),
      );
      if (owner) {
        await this.addToTrash(owner.key, { tbl, id: row.id, data: row });
      } else {
        // 照片的刪除可能比紀錄本身先到：用本機仍存在的紀錄找出所屬的完成紀錄
        const c = await d.completions.filter((x) => x.photoBlobId === row.id || x.thumbBlobId === row.id).first();
        if (c) await this.addToTrash(`completions:${c.id}`, { tbl, id: row.id, data: row });
      }
    }
  }

  private async addToTrash(key: string, item: TrashEntry['items'][number]) {
    const { d } = this;
    const prev = await d.trash.get(key);
    const items = (prev?.items ?? []).filter((i) => !(i.tbl === item.tbl && i.id === item.id));
    let label = prev?.label;
    let jobId = prev?.jobId;
    if (!label && key.startsWith('completions:')) {
      const c = await d.completions.get(key.slice('completions:'.length));
      jobId = c?.jobId;
      label = c ? jobById(c.jobId)?.nameZh : undefined;
    }
    await d.trash.put({ key, label: label ?? '職業體驗', jobId, deletedAt: prev?.deletedAt ?? this.now(), items: [...items, item] });
  }

  private async purgeTrash() {
    const cutoff = this.now() - TRASH_KEEP_MS;
    await this.d.trash.where('deletedAt').below(cutoff).delete();
  }

  // ───────── 照片下載 ─────────

  /** 縮圖：拉取後立即下載 */
  async downloadMissingThumbs(): Promise<void> {
    const missing = await this.d.blobs.filter((b) => b.kind === 'thumb' && !b.data && !!b.remotePath).toArray();
    const queue = [...missing];
    const worker = async () => {
      for (let b = queue.shift(); b; b = queue.shift()) await this.ensureBlob(b.id).catch(() => undefined);
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  /** 原圖：打開照片時才下載 */
  ensureBlob(id: string): Promise<void> {
    const running = this.downloading.get(id);
    if (running) return running;
    const p = (async () => {
      const b = await this.d.blobs.get(id);
      if (!b || b.data || !b.remotePath) return;
      const data = await this.remote.downloadPhoto(b.remotePath);
      await runAsRemote(this.d, [this.d.blobs], async () => {
        const cur = await this.d.blobs.get(id);
        if (cur && !cur.data) await this.d.blobs.update(id, { data });
      });
    })().finally(() => this.downloading.delete(id));
    this.downloading.set(id, p);
    return p;
  }

  // ───────── 還原 ─────────

  /** 還原最近刪除：呼叫 restore_record（刪除優先規則下唯一能復活的方式），再拉回最新內容 */
  async restore(key: string): Promise<void> {
    const { d } = this;
    const entry = await d.trash.get(key);
    if (!entry) return;
    const notOnServer = new Set<string>();
    for (const item of entry.items) {
      try {
        await this.remote.restoreRecord(item.tbl, item.id);
      } catch (e) {
        if (e instanceof SyncError && e.code === 'network') throw e;
        // record not found：從未上傳過，改由本機寫回後上傳
        notOnServer.add(`${item.tbl}:${item.id}`);
      }
    }
    await runAsRemote(d, tableList(d), async () => {
      for (const item of entry.items) {
        const table = syncTable(d, item.tbl);
        if (!(await table.get(item.id))) {
          if (item.tbl === 'blobs') {
            const b = item.data as StoredBlob;
            const uploaded = !notOnServer.has(`blobs:${b.id}`);
            await d.blobs.put({ ...b, remotePath: uploaded ? (b.remotePath ?? photoPath(this.familyId, b.id)) : undefined, uploaded });
          } else {
            await table.put(item.data as { id: string } & Record<string, unknown>);
          }
        }
        if (notOnServer.has(`${item.tbl}:${item.id}`)) {
          await d.outbox.put({ tbl: item.tbl, rowId: item.id, op: 'put', seq: nextSeq(), queuedAt: this.now() });
        }
      }
      await d.trash.delete(key);
    });
    await this.syncNow();
  }
}
