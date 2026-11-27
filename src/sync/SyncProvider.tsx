import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db } from '../db/db';
import { shrinkIfNeeded } from '../lib/photo';
import { restoreTrashLocal } from '../lib/trash';
import { localStorageFamilyCache, resolveAccount, type AccountState, type FamilyCache } from './account';
import type { AccountBackend, AuthUser, Invite } from './backend';
import { normalizeEmail, normalizeInviteCode } from './backend';
import { syncEnabled } from './client';
import { clearSyncedLocalData, getSyncState, loadSyncFamily, localDataCount, SyncEngine, type AttachMode, type SyncStatus } from './engine';
import { mapAuthError, SyncError } from './errors';
import type { RemoteStore } from './remote';
import { setActiveEngine } from './runtime';

export interface SyncActions {
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  sendOtp(email: string): Promise<void>;
  verifyOtp(email: string, token: string): Promise<void>;
  /** 登出並清除本機的家庭資料快取（雲端保留；設定與本機官方地圖保留） */
  signOut(): Promise<void>;
  createFamily(name: string): Promise<void>;
  joinFamily(code: string): Promise<void>;
  createInvite(): Promise<Invite>;
  refresh(): Promise<void>;
  syncNow(): Promise<void>;
  /** 加入家庭時本機已有紀錄：合併上傳或捨棄本機 */
  chooseAttach(mode: 'merge' | 'discard'): Promise<void>;
  /** 還原最近刪除（家庭模式需連線） */
  restore(key: string): Promise<void>;
}

export interface AttachPrompt {
  familyName: string;
  /** 本機會同步的資料總筆數（入園、帳、孩子資料等） */
  localCount: number;
  /** 其中的蓋章紀錄數 */
  completions: number;
}

interface SyncContextValue {
  state: AccountState;
  /** 同步引擎狀態（已加入家庭且已連上時才有） */
  sync: SyncStatus | null;
  attachPrompt: AttachPrompt | null;
  actions: SyncActions;
}

const SyncContext = createContext<SyncContextValue | null>(null);

const disabledError = () => Promise.reject(new SyncError('unknown', 'sync disabled'));

// 開機即讀回 familyId，讓 hooks 不必等帳號狀態就開始記錄離線變更
if (syncEnabled) void loadSyncFamily(db);

/**
 * 家庭同步：帳號狀態＋同步引擎生命週期。未啟用同步時固定為 disabled，且不會載入 supabase-js。
 * backend／remote／cache 可由外部注入（測試用）。
 */
export function SyncProvider({
  children,
  backend: injected,
  remote: injectedRemote,
  cache = localStorageFamilyCache,
}: {
  children: ReactNode;
  backend?: AccountBackend;
  remote?: RemoteStore;
  cache?: FamilyCache;
}) {
  const enabled = syncEnabled || !!injected;
  const [state, setState] = useState<AccountState>(enabled ? { status: 'loading' } : { status: 'disabled' });
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [attachPrompt, setAttachPrompt] = useState<AttachPrompt | null>(null);
  const backendRef = useRef<AccountBackend | null>(injected ?? null);
  const remoteRef = useRef<RemoteStore | null>(injectedRemote ?? null);
  const engineRef = useRef<SyncEngine | null>(null);
  const pendingEngine = useRef<SyncEngine | null>(null);
  const justCreated = useRef(false);

  const getBackend = useCallback(async () => {
    if (backendRef.current) return backendRef.current;
    const { SupabaseAccountBackend } = await import('./supabaseBackend');
    backendRef.current = await SupabaseAccountBackend.create();
    return backendRef.current;
  }, []);

  const getRemote = useCallback(async () => {
    if (remoteRef.current) return remoteRef.current;
    const { SupabaseRemoteStore } = await import('./supabaseRemote');
    remoteRef.current = await SupabaseRemoteStore.create();
    return remoteRef.current;
  }, []);

  const resolve = useCallback(
    async (user?: AuthUser | null) => {
      const be = await getBackend();
      const u = user === undefined ? await be.getUser() : user;
      setState(await resolveAccount(be, u, cache));
    },
    [getBackend, cache],
  );

  const stopEngine = useCallback(() => {
    engineRef.current?.stop();
    engineRef.current = null;
    pendingEngine.current = null;
    setActiveEngine(null);
    setSync(null);
    setAttachPrompt(null);
  }, []);

  const startEngine = useCallback(async (eng: SyncEngine, mode: AttachMode) => {
    engineRef.current = eng;
    setActiveEngine(eng);
    eng.subscribe(setSync);
    await eng.attach(mode);
  }, []);

  // 帳號狀態 → 啟動／停止同步引擎
  const familyId = state.status === 'inFamily' ? state.snapshot.family.id : null;
  const familyName = state.status === 'inFamily' ? state.snapshot.family.name : '';
  useEffect(() => {
    if (!familyId) {
      if (state.status !== 'loading') stopEngine();
      return;
    }
    if (engineRef.current?.familyId === familyId || pendingEngine.current?.familyId === familyId) return;
    stopEngine();
    let cancelled = false;
    void (async () => {
      const remote = await getRemote();
      if (cancelled) return;
      const eng = new SyncEngine(db, remote, familyId, { autoSchedule: true, compress: shrinkIfNeeded });
      const stored = await getSyncState<string>(db, 'familyId');
      if (stored === familyId) return startEngine(eng, 'resume');
      if (justCreated.current) {
        justCreated.current = false;
        return startEngine(eng, 'upload'); // 建立家庭：本機全部上傳
      }
      const count = await localDataCount(db);
      if (count === 0) return startEngine(eng, 'discard'); // 本機沒有資料：直接全量下載
      pendingEngine.current = eng;
      setAttachPrompt({ familyName, localCount: count, completions: await db.completions.count() });
    })().catch((e) => console.error('同步引擎啟動失敗', e));
    return () => {
      cancelled = true;
    };
  }, [familyId, familyName, state.status, getRemote, startEngine, stopEngine]);

  useEffect(() => () => stopEngine(), [stopEngine]);

  useEffect(() => {
    if (!enabled) return;
    let unsub: (() => void) | undefined;
    let alive = true;
    void (async () => {
      try {
        const be = await getBackend();
        if (!alive) return;
        unsub = be.onAuthChange((u) => void resolve(u));
        await resolve();
      } catch (e) {
        if (alive) setState({ status: 'signedOut' });
        console.error('同步模組載入失敗', e);
      }
    })();
    const onOnline = () => void resolve();
    // 回到前景時重讀家庭資料（例如家人剛加入），最多 30 秒一次
    let lastVisible = 0;
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastVisible < 30_000) return;
      lastVisible = Date.now();
      void resolve().catch(() => undefined);
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      unsub?.();
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, getBackend, resolve]);

  const actions = useMemo<SyncActions>(() => {
    if (!enabled) {
      return {
        signIn: disabledError,
        signUp: disabledError,
        sendOtp: disabledError,
        verifyOtp: disabledError,
        signOut: disabledError,
        createFamily: disabledError,
        joinFamily: disabledError,
        createInvite: disabledError,
        refresh: disabledError,
        syncNow: disabledError,
        chooseAttach: disabledError,
        restore: (key) => restoreTrashLocal(key),
      };
    }
    const run = async <T,>(fn: (be: AccountBackend) => Promise<T>): Promise<T> => {
      const be = await getBackend();
      try {
        return await fn(be);
      } catch (e) {
        throw e instanceof SyncError ? e : mapAuthError(e);
      }
    };
    return {
      signIn: (email, pw) => run(async (be) => void (await resolve(await be.signInWithPassword(normalizeEmail(email), pw)))),
      signUp: (email, pw) => run(async (be) => void (await resolve(await be.signUp(normalizeEmail(email), pw)))),
      sendOtp: (email) => run((be) => be.sendEmailOtp(normalizeEmail(email))),
      verifyOtp: (email, token) => run(async (be) => void (await resolve(await be.verifyEmailOtp(normalizeEmail(email), token.trim())))),
      signOut: () =>
        run(async (be) => {
          // 只有這支手機已接上家庭同步時才清除本機快取；尚未加入家庭的本機紀錄不動
          const attached = await getSyncState<string>(db, 'familyId');
          stopEngine();
          await be.signOut();
          if (attached) await clearSyncedLocalData(db);
          cache.clear();
          setState({ status: 'signedOut' });
        }),
      createFamily: (name) =>
        run(async (be) => {
          justCreated.current = true;
          try {
            await be.createFamily(name.trim() || '我的家庭');
          } catch (e) {
            justCreated.current = false;
            throw e;
          }
          await resolve();
        }),
      joinFamily: (code) =>
        run(async (be) => {
          await be.joinFamily(normalizeInviteCode(code));
          await resolve();
        }),
      createInvite: () => run((be) => be.createInvite()),
      refresh: () => run(() => resolve()),
      syncNow: async () => {
        await engineRef.current?.syncNow();
      },
      chooseAttach: async (mode) => {
        const eng = pendingEngine.current;
        if (!eng) return;
        pendingEngine.current = null;
        setAttachPrompt(null);
        await startEngine(eng, mode);
      },
      restore: async (key) => {
        const eng = engineRef.current;
        if (eng) await eng.restore(key);
        else await restoreTrashLocal(key);
      },
    };
  }, [enabled, getBackend, resolve, cache, stopEngine, startEngine]);

  const value = useMemo(() => ({ state, sync, attachPrompt, actions }), [state, sync, attachPrompt, actions]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSyncAccount(): SyncContextValue {
  const v = useContext(SyncContext);
  if (!v) throw new Error('useSyncAccount 需要在 <SyncProvider> 裡使用');
  return v;
}
