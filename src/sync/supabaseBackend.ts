import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { AccountBackend, AuthUser, FamilySnapshot, Invite } from './backend';
import { AUTH_STORAGE_KEY, getSupabase } from './client';
import { mapAuthError, mapDbError, SyncError } from './errors';

function toUser(u: User): AuthUser {
  return { id: u.id, email: u.email ?? null };
}

/** 以 supabase-js 實作帳號與家庭功能（只在啟用同步時被載入） */
export class SupabaseAccountBackend implements AccountBackend {
  private constructor(private readonly sb: SupabaseClient) {}

  static async create(): Promise<SupabaseAccountBackend> {
    return new SupabaseAccountBackend(await getSupabase());
  }

  async getUser(): Promise<AuthUser | null> {
    // getSession 讀本機儲存，不需要網路
    const { data } = await this.sb.auth.getSession();
    return data.session ? toUser(data.session.user) : null;
  }

  onAuthChange(cb: (user: AuthUser | null) => void): () => void {
    const { data } = this.sb.auth.onAuthStateChange((_event, session) => cb(session ? toUser(session.user) : null));
    return () => data.subscription.unsubscribe();
  }

  async signInWithPassword(email: string, password: string): Promise<AuthUser> {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw mapAuthError(error);
    return toUser(data.user);
  }

  async signUp(email: string, password: string): Promise<AuthUser> {
    const { data, error } = await this.sb.auth.signUp({ email, password });
    if (error) throw mapAuthError(error);
    // 後台仍開著 Confirm email 時不會直接拿到 session
    if (!data.session || !data.user) throw new SyncError('email_confirmation_required');
    return toUser(data.user);
  }

  async sendEmailOtp(email: string): Promise<void> {
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) throw mapAuthError(error);
  }

  async verifyEmailOtp(email: string, token: string): Promise<AuthUser> {
    const { data, error } = await this.sb.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw mapAuthError(error);
    if (!data.user) throw new SyncError('otp_invalid');
    return toUser(data.user);
  }

  async signOut(): Promise<void> {
    // scope: 'local'：只登出這支手機
    const { error } = await this.sb.auth.signOut({ scope: 'local' });
    if (error) {
      const mapped = mapAuthError(error);
      if (mapped.code !== 'network') throw mapped;
      // 離線時 supabase-js 不會清掉 session：直接移除本機登入資訊
      try {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }

  async getMyFamily(userId: string): Promise<FamilySnapshot | null> {
    const mine = await this.sb.from('family_members').select('family_id').eq('user_id', userId).maybeSingle();
    if (mine.error) throw mapDbError(mine.error);
    if (!mine.data) return null;
    const familyId = (mine.data as { family_id: string }).family_id;
    const [fam, members] = await Promise.all([
      this.sb.from('families').select('id, name, owner_id').eq('id', familyId).single(),
      this.sb.from('family_members').select('user_id, email, joined_at').eq('family_id', familyId).order('joined_at'),
    ]);
    if (fam.error) throw mapDbError(fam.error);
    if (members.error) throw mapDbError(members.error);
    const f = fam.data as { id: string; name: string; owner_id: string | null };
    return {
      family: { id: f.id, name: f.name, ownerId: f.owner_id },
      members: (members.data as { user_id: string; email: string | null; joined_at: string }[]).map((m) => ({
        userId: m.user_id,
        email: m.email,
        joinedAt: m.joined_at,
      })),
    };
  }

  async createFamily(name: string): Promise<string> {
    const { data, error } = await this.sb.rpc('create_family', { p_name: name });
    if (error) throw mapDbError(error);
    return data as string;
  }

  async createInvite(): Promise<Invite> {
    const { data, error } = await this.sb.rpc('create_invite');
    if (error) throw mapDbError(error);
    const row = (Array.isArray(data) ? data[0] : data) as { invite_code: string; invite_expires_at: string } | undefined;
    if (!row) throw new SyncError('unknown', 'create_invite 沒有回傳資料');
    return { code: row.invite_code, expiresAt: row.invite_expires_at };
  }

  async joinFamily(code: string): Promise<string> {
    const { data, error } = await this.sb.rpc('join_family', { p_code: code });
    if (error) throw mapDbError(error);
    return data as string;
  }
}
