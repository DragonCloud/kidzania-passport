import type { SupabaseClient } from '@supabase/supabase-js';
import type { SyncTable } from '../types/models';
import { getSupabase } from './client';
import { isNetworkError, mapDbError, SyncError } from './errors';
import type { RealtimeStatus, RemoteRecord, RemoteRecordInput, RemoteStore } from './remote';

const BUCKET = 'photos';

function fail(e: unknown): never {
  if (e instanceof SyncError) throw e;
  if (isNetworkError(e)) throw new SyncError('network', String((e as { message?: string })?.message ?? e));
  // Storage 的連線錯誤沒有 status，訊息含 fetch
  const msg = String((e as { message?: string })?.message ?? '');
  if (/fetch|network/i.test(msg)) throw new SyncError('network', msg);
  throw mapDbError(e);
}

/** 以 supabase-js 實作 RemoteStore（只在啟用同步時被動態載入） */
export class SupabaseRemoteStore implements RemoteStore {
  private constructor(private readonly sb: SupabaseClient) {}

  static async create(): Promise<SupabaseRemoteStore> {
    return new SupabaseRemoteStore(await getSupabase());
  }

  /** 測試用：注入 client */
  static fromClient(sb: SupabaseClient): SupabaseRemoteStore {
    return new SupabaseRemoteStore(sb);
  }

  async upsertRecords(familyId: string, rows: RemoteRecordInput[]): Promise<RemoteRecord[]> {
    if (!rows.length) return [];
    try {
      const { data, error } = await this.sb
        .from('records')
        .upsert(
          rows.map((r) => ({ family_id: familyId, tbl: r.tbl, id: r.id, data: r.data, deleted: r.deleted, client_updated_at: r.client_updated_at })),
          { onConflict: 'family_id,tbl,id' },
        )
        .select('tbl, id, data, deleted, updated_at, client_updated_at');
      if (error) fail(error);
      return (data ?? []) as RemoteRecord[];
    } catch (e) {
      fail(e);
    }
  }

  async pullSince(familyId: string, since: string | null, limit: number): Promise<RemoteRecord[]> {
    try {
      let q = this.sb.from('records').select('tbl, id, data, deleted, updated_at, client_updated_at').eq('family_id', familyId);
      if (since) q = q.gt('updated_at', since);
      const { data, error } = await q.order('updated_at', { ascending: true }).limit(limit);
      if (error) fail(error);
      return (data ?? []) as RemoteRecord[];
    } catch (e) {
      fail(e);
    }
  }

  /**
   * Realtime 訂閱：先用「登入後的 session」設定 Realtime 身分再加入頻道，
   * 否則頻道會以 anon 身分加入，在 RLS 下收不到任何變更。
   * （token 換發後 supabase-js 會自動更新 Realtime 身分。）
   */
  subscribe(familyId: string, onRecord: (r: RemoteRecord) => void, onStatus: (s: RealtimeStatus) => void): () => void {
    let channel: ReturnType<SupabaseClient['channel']> | null = null;
    let cancelled = false;
    void (async () => {
      const { data } = await this.sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token || cancelled) {
        onStatus('disconnected');
        return;
      }
      await this.sb.realtime.setAuth(token);
      if (cancelled) return;
      channel = this.sb
        .channel(`records:${familyId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: `family_id=eq.${familyId}` }, (payload) => {
          const row = payload.new as Partial<RemoteRecord> | undefined;
          if (row && row.tbl && row.id && row.updated_at) onRecord(row as RemoteRecord);
        })
        .subscribe((status) => onStatus(status === 'SUBSCRIBED' ? 'connected' : 'disconnected'));
    })().catch(() => onStatus('disconnected'));
    return () => {
      cancelled = true;
      if (channel) void this.sb.removeChannel(channel);
    };
  }

  async uploadPhoto(path: string, blob: Blob): Promise<void> {
    try {
      const { error } = await this.sb.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '31536000' });
      if (error) fail(error);
    } catch (e) {
      fail(e);
    }
  }

  async downloadPhoto(path: string): Promise<Blob> {
    try {
      const { data, error } = await this.sb.storage.from(BUCKET).download(path);
      if (error) fail(error);
      return data as Blob;
    } catch (e) {
      fail(e);
    }
  }

  async restoreRecord(tbl: SyncTable, id: string): Promise<void> {
    try {
      const { error } = await this.sb.rpc('restore_record', { p_tbl: tbl, p_id: id });
      if (error) fail(error);
    } catch (e) {
      fail(e);
    }
  }
}
