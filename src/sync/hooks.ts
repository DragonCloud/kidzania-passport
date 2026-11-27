import type { Table, Transaction } from 'dexie';
import type { AppDB } from '../db/db';
import { SYNC_TABLES, type OutboxEntry, type SyncTable } from '../types/models';

/**
 * Dexie hooks：child／visits／completions／ledger／blobs 的新增、修改、刪除 → 寫入 outbox。
 * - 只有在這支手機已加入家庭（runtime.familyId）時才記錄
 * - 套用雲端資料的交易（runAsRemote）不記錄，避免回送
 * - 官方地圖（blobs.kind = 'official-map'）永不記錄；settings 表沒有掛 hook
 * - 交易若包含 outbox，就在同一個交易內寫入（原子）；否則交易完成後補寫
 */
interface Runtime {
  familyId: string | null;
  onLocalChange?: () => void;
}

const runtimes = new WeakMap<AppDB, Runtime>();

export function syncRuntime(d: AppDB): Runtime {
  let rt = runtimes.get(d);
  if (!rt) {
    rt = { familyId: null };
    runtimes.set(d, rt);
  }
  return rt;
}

let lastSeq = 0;
/** 單調遞增的送出序號（跨重新整理也遞增：以毫秒時間為基礎） */
export function nextSeq(): number {
  lastSeq = Math.max(lastSeq + 1, Date.now() * 1000);
  return lastSeq;
}

const REMOTE = '__kzpRemote';
const PENDING = '__kzpPending';
const NOTIFY = '__kzpNotify';

type Tx = Transaction & { [REMOTE]?: boolean; [PENDING]?: OutboxEntry[]; [NOTIFY]?: boolean; parent?: Tx };

function isRemote(trans: Tx | undefined): boolean {
  for (let t = trans; t; t = t.parent) if (t[REMOTE]) return true;
  return false;
}

/** 以「雲端來源」身分執行寫入：hooks 不會把這些變更放進 outbox */
export function runAsRemote<T>(d: AppDB, tables: Table[], fn: () => Promise<T>): Promise<T> {
  return d.transaction('rw', tables, async (tx) => {
    (tx as Tx)[REMOTE] = true;
    return fn();
  });
}

function shouldSkip(tbl: SyncTable, obj: unknown): boolean {
  return tbl === 'blobs' && (obj as { kind?: string } | undefined)?.kind === 'official-map';
}

/** 刪除時保存的內容：照片只存中繼資料，不存圖檔本體 */
export function snapshotOf(tbl: SyncTable, obj: unknown): unknown {
  if (tbl === 'blobs' && obj && typeof obj === 'object') {
    const { data: _data, uploaded: _u, ...meta } = obj as Record<string, unknown>;
    return meta;
  }
  return obj;
}

function enqueue(d: AppDB, trans: Tx, entry: Omit<OutboxEntry, 'seq' | 'queuedAt'>) {
  const rt = syncRuntime(d);
  if (!rt.familyId || isRemote(trans)) return;
  const full: OutboxEntry = { ...entry, seq: nextSeq(), queuedAt: Date.now() };
  if (trans.storeNames.includes('outbox')) {
    void trans.table('outbox').put(full);
  } else {
    // 隱含的單表交易：交易完成後另外寫入
    if (!trans[PENDING]) {
      trans[PENDING] = [];
      trans.on('complete', () => {
        const list = trans[PENDING] ?? [];
        void d.outbox.bulkPut(list).then(() => rt.onLocalChange?.());
      });
    }
    trans[PENDING]!.push(full);
    return;
  }
  if (!trans[NOTIFY]) {
    trans[NOTIFY] = true;
    trans.on('complete', () => rt.onLocalChange?.());
  }
}

const installed = new WeakSet<AppDB>();

export function installSyncHooks(d: AppDB): void {
  if (installed.has(d)) return;
  installed.add(d);
  for (const tbl of SYNC_TABLES) {
    const table = d.table(tbl);
    table.hook('creating', function (primKey, obj, trans) {
      if (shouldSkip(tbl, obj)) return;
      enqueue(d, trans as Tx, { tbl, rowId: String(primKey ?? (obj as { id: string }).id), op: 'put' });
    });
    table.hook('updating', function (_mods, primKey, obj, trans) {
      if (shouldSkip(tbl, obj)) return;
      enqueue(d, trans as Tx, { tbl, rowId: String(primKey), op: 'put' });
    });
    table.hook('deleting', function (primKey, obj, trans) {
      if (shouldSkip(tbl, obj)) return;
      enqueue(d, trans as Tx, { tbl, rowId: String(primKey), op: 'delete', snapshot: snapshotOf(tbl, obj) });
    });
  }
}
