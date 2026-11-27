/**
 * 請瀏覽器把本站資料標為「持久保存」，降低 iOS Safari／Chrome 在空間不足或久未使用時清除 IndexedDB 的機率。
 * 不保證一定成功（尤其 Safari 未加入主畫面時），所以仍需定期匯出備份。
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isPersisted(): Promise<boolean | null> {
  try {
    return navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  } catch {
    return null;
  }
}

export interface StorageUsage {
  usedBytes: number;
  quotaBytes: number;
}

export async function storageUsage(): Promise<StorageUsage | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e || e.usage === undefined || e.quota === undefined) return null;
    return { usedBytes: e.usage, quotaBytes: e.quota };
  } catch {
    return null;
  }
}

/** 是否以「加入主畫面」的獨立視窗開啟 */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
