import Dexie, { type EntityTable } from 'dexie';
import { installSyncHooks } from '../sync/hooks';
import type {
  AppSetting,
  ChildProfile,
  Completion,
  LedgerEntry,
  OutboxEntry,
  StoredBlob,
  SyncStateRow,
  TrashEntry,
  Visit,
} from '../types/models';

export const DB_NAME = 'kidzania-passport';

export class AppDB extends Dexie {
  child!: EntityTable<ChildProfile, 'id'>;
  visits!: EntityTable<Visit, 'id'>;
  completions!: EntityTable<Completion, 'id'>;
  ledger!: EntityTable<LedgerEntry, 'id'>;
  blobs!: EntityTable<StoredBlob, 'id'>;
  settings!: EntityTable<AppSetting, 'key'>;
  // version 2：家庭同步
  outbox!: Dexie.Table<OutboxEntry, [string, string]>;
  syncState!: EntityTable<SyncStateRow, 'key'>;
  trash!: EntityTable<TrashEntry, 'key'>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      child: 'id',
      visits: 'id, visitDate',
      completions: 'id, jobId, visitId, completedAt',
      ledger: 'id, visitId, at, completionId, currency, jobId',
      blobs: 'id, kind',
      settings: 'key',
    });
    this.version(2).stores({
      outbox: '[tbl+rowId], seq',
      syncState: 'key',
      trash: 'key, deletedAt',
    });
    // 家庭同步：記錄本機變更（未加入家庭時不做任何事）
    installSyncHooks(this);
  }
}

export const db = new AppDB();

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 所有使用者資料表（清除／匯入時一起處理） */
export function allTables(d: AppDB = db) {
  return [d.child, d.visits, d.completions, d.ledger, d.blobs, d.settings, d.outbox, d.syncState, d.trash];
}

/** 會同步的 Dexie 資料表 */
export function syncTable(d: AppDB, tbl: import('../types/models').SyncTable) {
  return d[tbl] as unknown as Dexie.Table<{ id: string } & Record<string, unknown>, string>;
}
