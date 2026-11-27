import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../../db/db';
import { useSyncAccount } from '../../sync/SyncProvider';

/** 總覽頁頁首的小同步圖示：✓ 已同步／↻ 同步中／離線 n／! 錯誤；只在已加入家庭時顯示 */
export function SyncBadge() {
  const { state, sync } = useSyncAccount();
  const pending = useLiveQuery(() => db.outbox.count(), [], 0);
  if (state.status !== 'inFamily') return null;
  const phase = sync?.phase ?? (state.offline ? 'offline' : 'idle');

  let icon = '↻';
  let text = '同步中';
  let cls = 'bg-sky-50 text-sky-800 ring-sky-200';
  if (phase === 'synced' && pending === 0) {
    icon = '✓';
    text = '已同步';
    cls = 'bg-emerald-50 text-emerald-800 ring-emerald-200';
  } else if (phase === 'offline') {
    icon = '⌁';
    text = pending > 0 ? `離線・待送 ${pending}` : '離線';
    cls = 'bg-amber-50 text-amber-900 ring-amber-300';
  } else if (phase === 'error' || phase === 'paused') {
    icon = '!';
    text = phase === 'paused' ? '雲端暫停' : '同步失敗';
    cls = 'bg-red-50 text-red-800 ring-red-200';
  } else if (pending > 0) {
    text = `待送 ${pending}`;
  }

  return (
    <Link
      to="/settings"
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${cls}`}
      aria-label={`家庭同步：${text}`}
      data-sync-phase={phase}
    >
      <span aria-hidden="true" className={phase === 'syncing' ? 'inline-block animate-spin' : ''}>
        {icon}
      </span>
      {text}
    </Link>
  );
}
