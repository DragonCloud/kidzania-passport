import type { SyncStatus } from '../../sync/engine';
import { formatDateTime } from '../../lib/format';

type Phase = SyncStatus['phase'] | 'notStarted';

const VIEW: Record<Phase, { dot: string; title: string }> = {
  notStarted: { dot: 'bg-stone-300', title: '準備同步' },
  idle: { dot: 'bg-stone-300', title: '準備同步' },
  syncing: { dot: 'bg-sky-500 animate-pulse', title: '同步中' },
  synced: { dot: 'bg-earn', title: '已同步' },
  offline: { dot: 'bg-amber-500', title: '離線' },
  error: { dot: 'bg-red-600', title: '同步失敗' },
  paused: { dot: 'bg-red-600', title: '雲端可能已暫停' },
};

/** 同步狀態：已同步／同步中 n 筆／離線，待送 n 筆／錯誤＋重試／雲端可能已暫停 */
export function SyncStatusCard({
  sync,
  pending,
  cachedOffline = false,
  onSyncNow,
}: {
  sync: SyncStatus | null;
  pending: number;
  /** 帳號資料也只能用快取（連家庭資料都讀不到） */
  cachedOffline?: boolean;
  onSyncNow?: () => void;
}) {
  const phase: Phase = sync?.phase ?? (cachedOffline ? 'offline' : 'notStarted');
  const v = VIEW[phase];
  let detail: string;
  if (sync?.progress && phase === 'syncing') detail = `已上傳 ${sync.progress.done}／${sync.progress.total} 張照片`;
  else if (phase === 'paused')
    detail = '連續 24 小時連不上雲端。免費專案一週沒有活動會自動暫停：請管理者到 Supabase 後台打開專案並按「Resume project」。紀錄會先留在這支手機，恢復後自動補送。';
  else if (phase === 'offline') detail = pending > 0 ? `恢復連線後會自動上傳。` : '恢復連線後會自動同步。';
  else if (phase === 'error') detail = sync?.error ?? '請稍後再試。';
  else if (sync?.lastSyncAt) detail = `上次同步：${formatDateTime(sync.lastSyncAt)}`;
  else detail = '還沒有同步紀錄';

  return (
    <div className={`rounded-2xl p-3 ${phase === 'paused' || phase === 'error' ? 'bg-red-50 ring-1 ring-red-200' : 'bg-paper'}`} role="status" aria-label={`同步狀態：${v.title}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${v.dot}`} />
        <span className="text-sm font-bold">
          {v.title}
          {pending > 0 && phase !== 'synced' && <span className="font-medium text-ink/60">・待送 {pending} 筆</span>}
        </span>
        <button
          type="button"
          disabled={!onSyncNow || phase === 'syncing'}
          onClick={onSyncNow}
          className="ml-auto rounded-full bg-white px-3 py-1.5 text-xs font-bold ring-1 ring-ink/15 disabled:opacity-40"
        >
          {phase === 'error' ? '重試' : '立即同步'}
        </button>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink/60">{detail}</p>
    </div>
  );
}
