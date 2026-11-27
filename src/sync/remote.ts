import type { SyncTable } from '../types/models';

/**
 * 同步引擎使用的雲端介面。正式版由 supabaseRemote 實作（records 表＋photos bucket），
 * 測試用 testing/memoryRemote（行為對齊 schema.sql：伺服器時間、刪除優先、還原）。
 * 失敗一律拋 SyncError：code 'network' 代表離線／暫停，其他代表資料或權限錯誤。
 */
export interface RemoteRecordInput {
  tbl: SyncTable;
  id: string;
  data: unknown;
  deleted: boolean;
  client_updated_at: number;
}

export interface RemoteRecord extends RemoteRecordInput {
  /** 伺服器時間（ISO，含微秒） */
  updated_at: string;
}

export type RealtimeStatus = 'connected' | 'disconnected';

export interface RemoteStore {
  /**
   * 依 (family_id, tbl, id) 批次 upsert；updated_at／updated_by 由伺服器決定。
   * 回傳伺服器寫入後的實際內容（.select() 讀回）：刪除優先規則下，送出 deleted=false 也可能讀回 deleted=true。
   */
  upsertRecords(familyId: string, rows: RemoteRecordInput[]): Promise<RemoteRecord[]>;
  /** updated_at > since（since=null 表示全部），依 updated_at 由舊到新 */
  pullSince(familyId: string, since: string | null, limit: number): Promise<RemoteRecord[]>;
  /** 訂閱這個家庭的 records 變更（Realtime） */
  subscribe(familyId: string, onRecord: (r: RemoteRecord) => void, onStatus: (s: RealtimeStatus) => void): () => void;
  uploadPhoto(path: string, blob: Blob): Promise<void>;
  downloadPhoto(path: string): Promise<Blob>;
  /** 呼叫 restore_record RPC（刪除優先規則下，唯一能讓已刪除紀錄復活的方式） */
  restoreRecord(tbl: SyncTable, id: string): Promise<void>;
}

/** 照片在 Storage 的路徑 */
export function photoPath(familyId: string, blobId: string): string {
  return `${familyId}/${blobId}.jpg`;
}
