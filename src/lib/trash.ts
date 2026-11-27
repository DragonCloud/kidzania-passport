import { db, syncTable, type AppDB } from '../db/db';
import { SYNC_TABLES } from '../types/models';

export const TRASH_KEEP_DAYS = 30;

/**
 * 本機模式（未加入家庭）的還原：把最近刪除的內容寫回本機。
 * 已加入家庭時請改用 SyncEngine.restore()（需連線，呼叫 restore_record）。
 */
export async function restoreTrashLocal(key: string, d: AppDB = db): Promise<void> {
  await d.transaction('rw', [...SYNC_TABLES.map((t) => syncTable(d, t)), d.outbox, d.trash], async () => {
    const entry = await d.trash.get(key);
    if (!entry) return;
    for (const item of entry.items) {
      const table = syncTable(d, item.tbl);
      if (!(await table.get(item.id))) await table.put(item.data as { id: string } & Record<string, unknown>);
    }
    await d.trash.delete(key);
  });
}

export async function purgeOldTrash(now = Date.now(), d: AppDB = db): Promise<number> {
  return d.trash.where('deletedAt').below(now - TRASH_KEEP_DAYS * 86_400_000).delete();
}
