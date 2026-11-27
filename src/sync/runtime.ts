import type { SyncEngine } from './engine';

/**
 * 目前作用中的同步引擎（只有已加入家庭時才有）。
 * 讓不在 SyncProvider 內的工具（例如 useBlobUrl 按需下載原圖）也能取用。
 */
let active: SyncEngine | null = null;

export function setActiveEngine(e: SyncEngine | null): void {
  active = e;
}

export function getActiveEngine(): SyncEngine | null {
  return active;
}
