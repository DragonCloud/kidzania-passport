import type { SyncTable } from '../../types/models';
import { SyncError } from '../errors';
import type { RealtimeStatus, RemoteRecord, RemoteRecordInput, RemoteStore } from '../remote';

/**
 * 測試用記憶體雲端：行為對齊 schema.sql
 * - updated_at 由「伺服器」決定且嚴格遞增
 * - 刪除優先：已刪除的紀錄不會被 deleted=false 的 upsert 復活（但 updated_at 仍更新）
 * - restoreRecord 才能復活
 * - 可模擬離線、單次失敗、Realtime 推送
 */
export class MemoryRemoteStore implements RemoteStore {
  offline = false;
  /** 下一次指定操作失敗（模擬上傳失敗等），code 預設 network */
  private failures: { op: string; code: 'network' | 'unknown' }[] = [];
  private records = new Map<string, RemoteRecord & { familyId: string }>();
  readonly photos = new Map<string, Blob>();
  private listeners = new Map<string, Set<(r: RemoteRecord) => void>>();
  private tick = 0;
  /** 呼叫紀錄（測試檢查順序用） */
  readonly calls: string[] = [];
  /** 每次 upsert 的筆數（檢查是否批次） */
  readonly upsertBatches: number[] = [];
  /** Realtime 是否自動推送（false 時測試只能靠 pull） */
  realtime = true;

  failNext(op: 'upsert' | 'pull' | 'upload' | 'download' | 'restore', code: 'network' | 'unknown' = 'network') {
    this.failures.push({ op, code });
  }

  private guard(op: string) {
    this.calls.push(op);
    if (this.offline) throw new SyncError('network', 'offline');
    const i = this.failures.findIndex((f) => f.op === op);
    if (i >= 0) {
      const [f] = this.failures.splice(i, 1);
      throw new SyncError(f!.code, `injected ${op} failure`);
    }
  }

  private now(): string {
    this.tick += 1;
    // 固定基準時間＋遞增微秒，確保嚴格遞增
    return new Date(Date.UTC(2026, 10, 27, 0, 0, 0) + this.tick).toISOString();
  }

  private key(familyId: string, tbl: string, id: string) {
    return `${familyId}|${tbl}|${id}`;
  }

  async upsertRecords(familyId: string, rows: RemoteRecordInput[]): Promise<RemoteRecord[]> {
    this.guard('upsert');
    const changed: (RemoteRecord & { familyId: string })[] = [];
    for (const r of rows) {
      const k = this.key(familyId, r.tbl, r.id);
      const old = this.records.get(k);
      let next: RemoteRecord & { familyId: string } = { ...r, familyId, updated_at: this.now() };
      if (old?.deleted && !r.deleted) {
        // 刪除優先
        next = { ...old, updated_at: next.updated_at };
      }
      this.records.set(k, next);
      changed.push(next);
    }
    this.emit(familyId, changed);
    this.upsertBatches.push(rows.length);
    return changed.map(({ familyId: _f, ...r }) => structuredClone(r));
  }

  async pullSince(familyId: string, since: string | null, limit: number): Promise<RemoteRecord[]> {
    this.guard('pull');
    return [...this.records.values()]
      .filter((r) => r.familyId === familyId && (!since || r.updated_at > since))
      .sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1))
      .slice(0, limit)
      .map(({ familyId: _f, ...r }) => structuredClone(r));
  }

  private statusListeners = new Set<(s: RealtimeStatus) => void>();

  subscribe(familyId: string, onRecord: (r: RemoteRecord) => void, onStatus: (s: RealtimeStatus) => void): () => void {
    const set = this.listeners.get(familyId) ?? new Set();
    set.add(onRecord);
    this.listeners.set(familyId, set);
    this.statusListeners.add(onStatus);
    onStatus('connected');
    return () => {
      set.delete(onRecord);
      this.statusListeners.delete(onStatus);
    };
  }

  /** 測試輔助：模擬 Realtime 斷線／重連 */
  emitStatus(s: RealtimeStatus) {
    for (const l of this.statusListeners) l(s);
  }

  private emit(familyId: string, rows: RemoteRecord[]) {
    if (!this.realtime) return;
    const set = this.listeners.get(familyId);
    if (!set) return;
    for (const r of rows) for (const l of set) queueMicrotask(() => l(structuredClone(r)));
  }

  async uploadPhoto(path: string, blob: Blob): Promise<void> {
    this.guard('upload');
    this.photos.set(path, blob);
  }

  async downloadPhoto(path: string): Promise<Blob> {
    this.guard('download');
    const b = this.photos.get(path);
    if (!b) throw new SyncError('unknown', `object not found: ${path}`);
    return b;
  }

  async restoreRecord(tbl: SyncTable, id: string): Promise<void> {
    this.guard('restore');
    const r = [...this.records.values()].find((x) => x.tbl === tbl && x.id === id);
    if (!r) throw new SyncError('unknown', 'record not found');
    const next = { ...r, deleted: false, updated_at: this.now() };
    this.records.set(this.key(r.familyId, tbl, id), next);
    this.emit(r.familyId, [next]);
  }

  /** 測試輔助：讀雲端某筆 */
  get(familyId: string, tbl: SyncTable, id: string): RemoteRecord | undefined {
    return this.records.get(this.key(familyId, tbl, id));
  }

  count(familyId: string, tbl?: SyncTable, includeDeleted = false): number {
    return [...this.records.values()].filter((r) => r.familyId === familyId && (!tbl || r.tbl === tbl) && (includeDeleted || !r.deleted)).length;
  }
}
