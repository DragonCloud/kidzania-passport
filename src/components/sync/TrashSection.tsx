import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../../db/db';
import { formatDateTime } from '../../lib/format';
import { TRASH_KEEP_DAYS } from '../../lib/trash';
import { SyncError } from '../../sync/errors';
import { useSyncAccount } from '../../sync/SyncProvider';
import type { TrashEntry } from '../../types/models';

/** 最近刪除（30 天內可還原）。家庭模式需連線（呼叫 restore_record，兩支手機都會回來）。 */
export function TrashSection({ onMessage }: { onMessage: (m: string) => void }) {
  const { state, actions } = useSyncAccount();
  const entries = useLiveQuery(() => db.trash.orderBy('deletedAt').reverse().toArray(), [], [] as TrashEntry[]);
  const [busy, setBusy] = useState<string | null>(null);
  if (!entries.length) return null;
  const family = state.status === 'inFamily';

  async function restore(e: TrashEntry) {
    setBusy(e.key);
    try {
      await actions.restore(e.key);
      onMessage(`已還原「${e.label}」`);
    } catch (err) {
      onMessage(err instanceof SyncError && err.code === 'network' ? '需要連線才能還原，請連上網路後再試' : '還原失敗，請稍後再試');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <p className="text-sm text-ink/65">
        刪除的蓋章紀錄會保留 {TRASH_KEEP_DAYS} 天。{family ? '還原後兩支手機都會恢復（需要連線）。' : ''}
      </p>
      <ul className="mt-2 divide-y divide-ink/5 rounded-2xl bg-paper px-3">
        {entries.map((e) => {
          const photos = e.items.filter((i) => i.tbl === 'blobs' && (i.data as { kind?: string }).kind === 'photo').length;
          const ledger = e.items.filter((i) => i.tbl === 'ledger').length;
          return (
            <li key={e.key} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{e.label}</p>
                <p className="text-xs text-ink/50">
                  {formatDateTime(e.deletedAt)} 刪除
                  {photos ? `・照片 ${photos} 張` : ''}
                  {ledger ? `・帳 ${ledger} 筆` : ''}
                </p>
              </div>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void restore(e)}
                className="shrink-0 rounded-full bg-white px-3 py-1.5 text-sm font-bold text-brand ring-1 ring-brand/30 disabled:opacity-50"
              >
                {busy === e.key ? '還原中…' : '還原'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
