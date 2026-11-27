import type { AccountBackend, AuthUser, FamilySnapshot } from './backend';
import { mapDbError, SyncError } from './errors';

/**
 * 設定頁「家庭同步」的狀態：
 * - disabled：此版本未設定 Supabase
 * - loading：讀取中
 * - signedOut：未登入
 * - noFamily：已登入、尚未加入家庭
 * - inFamily：已在家庭（offline=true 表示目前用的是上次快取）
 */
export type AccountState =
  | { status: 'disabled' }
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'noFamily'; user: AuthUser }
  | { status: 'inFamily'; user: AuthUser; snapshot: FamilySnapshot; offline: boolean }
  | { status: 'unknownFamily'; user: AuthUser; error: SyncError };

/** 上次成功讀到的家庭資料，讓離線時仍顯示「已在家庭」 */
export interface FamilyCache {
  get(userId: string): FamilySnapshot | null;
  set(userId: string, snapshot: FamilySnapshot | null): void;
  clear(): void;
}

const CACHE_KEY = 'kidzania-passport-family';

export const localStorageFamilyCache: FamilyCache = {
  get(userId) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw) as { userId: string; snapshot: FamilySnapshot };
      return v.userId === userId ? v.snapshot : null;
    } catch {
      return null;
    }
  },
  set(userId, snapshot) {
    try {
      if (snapshot) localStorage.setItem(CACHE_KEY, JSON.stringify({ userId, snapshot }));
      else localStorage.removeItem(CACHE_KEY);
    } catch {
      /* 私密瀏覽等情況寫不進去就算了 */
    }
  },
  clear() {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      /* ignore */
    }
  },
};

/** 依登入者讀取家庭；網路失敗時改用快取 */
export async function resolveAccount(backend: AccountBackend, user: AuthUser | null, cache: FamilyCache): Promise<AccountState> {
  if (!user) return { status: 'signedOut' };
  try {
    const snapshot = await backend.getMyFamily(user.id);
    cache.set(user.id, snapshot);
    return snapshot ? { status: 'inFamily', user, snapshot, offline: false } : { status: 'noFamily', user };
  } catch (e) {
    const err = mapDbError(e);
    const cached = cache.get(user.id);
    if (cached) return { status: 'inFamily', user, snapshot: cached, offline: true };
    return { status: 'unknownFamily', user, error: err };
  }
}
