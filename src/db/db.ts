import Dexie, { type EntityTable } from 'dexie';
import type {
  AppSetting,
  ChildProfile,
  Completion,
  LedgerEntry,
  StoredBlob,
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
  }
}

export const db = new AppDB();

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 所有使用者資料表（清除／匯入時一起處理） */
export function allTables(d: AppDB = db) {
  return [d.child, d.visits, d.completions, d.ledger, d.blobs, d.settings];
}
