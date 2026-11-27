import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * PWA 更新提示：
 * - 第一次快取完成 → 「已可離線使用」（數秒後自動消失）
 * - 有新版本 → 由使用者按「更新」才重新整理，避免蓋章填到一半被打斷
 */
export function UpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // 每小時檢查一次新版本（App 長時間開著時）
      if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000);
    },
  });

  // 「已可離線使用」只提示一下就收起
  useEffect(() => {
    if (!offlineReady) return;
    const t = window.setTimeout(() => setOfflineReady(false), 4000);
    return () => window.clearTimeout(t);
  }, [offlineReady, setOfflineReady]);

  if (!offlineReady && !needRefresh) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[80] flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-white shadow-xl" role="status">
        <span className="flex-1">{needRefresh ? '有新版本可以使用' : '已可離線使用，園區沒網路也能查表、蓋章'}</span>
        {needRefresh ? (
          <>
            <button type="button" onClick={() => setNeedRefresh(false)} className="font-bold text-white/60">
              稍後
            </button>
            <button type="button" onClick={() => void updateServiceWorker(true)} className="rounded-full bg-brand px-3 py-1.5 font-bold">
              更新
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setOfflineReady(false)} className="font-bold text-white/60">
            好
          </button>
        )}
      </div>
    </div>
  );
}
