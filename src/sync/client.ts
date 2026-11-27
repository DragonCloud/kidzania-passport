import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 同步設定：讀取 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY（build 時由 Vite 帶入）。
 * - 任一缺少 → syncEnabled = false，App 照舊以本機模式運作。
 * - anon／publishable key 可以公開（資料靠 RLS 保護）；若誤填 service_role／secret key，拒絕啟用。
 * - supabase-js 以動態 import() 載入，未啟用同步時完全不下載。
 */
export interface SyncConfig {
  url: string;
  anonKey: string;
}

export type SyncConfigResult =
  | { enabled: true; config: SyncConfig }
  | { enabled: false; reason: 'missing' | 'invalid-url' | 'secret-key' };

function jwtRole(key: string): string | null {
  const part = key.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

export function readSyncConfig(env: Record<string, unknown>): SyncConfigResult {
  const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim() : '';
  const anonKey = typeof env.VITE_SUPABASE_ANON_KEY === 'string' ? env.VITE_SUPABASE_ANON_KEY.trim() : '';
  if (!url || !anonKey) return { enabled: false, reason: 'missing' };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { enabled: false, reason: 'invalid-url' };
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) return { enabled: false, reason: 'invalid-url' };
  if (anonKey.startsWith('sb_secret_') || jwtRole(anonKey) === 'service_role') return { enabled: false, reason: 'secret-key' };
  return { enabled: true, config: { url: parsed.origin, anonKey } };
}

export const syncConfig: SyncConfigResult = readSyncConfig(import.meta.env);
export const syncEnabled: boolean = syncConfig.enabled;

if (!syncConfig.enabled && syncConfig.reason === 'secret-key') {
  console.error('VITE_SUPABASE_ANON_KEY 看起來是 service_role／secret key，已停用同步。請改用 anon／publishable key。');
}

/** 登入狀態存在 localStorage 的鍵名（固定，不含專案代號） */
export const AUTH_STORAGE_KEY = 'kidzania-passport-auth';

let clientPromise: Promise<SupabaseClient> | null = null;

/** 動態載入 supabase-js 並建立唯一的 client；未啟用同步時拋錯 */
export function getSupabase(): Promise<SupabaseClient> {
  if (!syncConfig.enabled) return Promise.reject(new Error('sync disabled'));
  const { url, anonKey } = syncConfig.config;
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // 不使用 magic link（會跳到 Safari、回不到主畫面 App）
        detectSessionInUrl: false,
        storageKey: AUTH_STORAGE_KEY,
      },
    }),
  );
  return clientPromise;
}
