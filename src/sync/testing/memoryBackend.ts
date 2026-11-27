import type { AccountBackend, AuthUser, FamilySnapshot, Invite } from '../backend';
import { INVITE_ALPHABET, normalizeEmail, normalizeInviteCode } from '../backend';
import { SyncError } from '../errors';

/**
 * 測試用的記憶體後端：行為對齊 schema.sql 的 RPC 與 Supabase Auth 設定
 * （Confirm email 關閉、可切換「關閉註冊」、驗證碼不建立新帳號、可模擬離線）。
 * 不會被網站打包（只有測試 import）。
 */
export class MemoryAccountBackend implements AccountBackend {
  signupsEnabled = true;
  offline = false;
  /** 測試可讀取最近寄出的驗證碼 */
  lastOtp: { email: string; code: string } | null = null;

  private users = new Map<string, { id: string; email: string; password: string }>();
  private families = new Map<string, { id: string; name: string; ownerId: string }>();
  private members: { familyId: string; userId: string; email: string | null; joinedAt: string }[] = [];
  private invites = new Map<string, { familyId: string; expiresAt: number }>();
  private current: AuthUser | null = null;
  private listeners = new Set<(u: AuthUser | null) => void>();
  private seq = 0;
  now: () => number = () => Date.now();

  private guard() {
    if (this.offline) throw new SyncError('network', 'offline');
  }
  private setCurrent(u: AuthUser | null) {
    this.current = u;
    for (const l of this.listeners) l(u);
  }
  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }
  private requireUser(): AuthUser {
    if (!this.current) throw new SyncError('not_signed_in');
    return this.current;
  }

  async getUser() {
    return this.current;
  }
  onAuthChange(cb: (u: AuthUser | null) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  async signInWithPassword(email: string, password: string) {
    this.guard();
    const u = this.users.get(normalizeEmail(email));
    if (!u || u.password !== password) throw new SyncError('invalid_credentials');
    const user = { id: u.id, email: u.email };
    this.setCurrent(user);
    return user;
  }
  async signUp(email: string, password: string) {
    this.guard();
    if (!this.signupsEnabled) throw new SyncError('signup_disabled');
    const e = normalizeEmail(email);
    if (this.users.has(e)) throw new SyncError('user_exists');
    if (password.length < 6) throw new SyncError('weak_password');
    const u = { id: this.id('user'), email: e, password };
    this.users.set(e, u);
    const user = { id: u.id, email: e };
    this.setCurrent(user);
    return user;
  }
  async sendEmailOtp(email: string) {
    this.guard();
    const e = normalizeEmail(email);
    if (!this.users.has(e)) throw new SyncError('user_not_found'); // shouldCreateUser: false
    this.lastOtp = { email: e, code: String(100000 + ((this.seq * 7919) % 900000)) };
  }
  async verifyEmailOtp(email: string, token: string) {
    this.guard();
    const e = normalizeEmail(email);
    if (!this.lastOtp || this.lastOtp.email !== e || this.lastOtp.code !== token) throw new SyncError('otp_invalid');
    this.lastOtp = null;
    const u = this.users.get(e)!;
    const user = { id: u.id, email: u.email };
    this.setCurrent(user);
    return user;
  }
  async signOut() {
    this.setCurrent(null);
  }
  async getMyFamily(userId: string): Promise<FamilySnapshot | null> {
    this.guard();
    const m = this.members.find((x) => x.userId === userId);
    if (!m) return null;
    const f = this.families.get(m.familyId)!;
    return {
      family: { ...f },
      members: this.members.filter((x) => x.familyId === f.id).map(({ userId: uid, email, joinedAt }) => ({ userId: uid, email, joinedAt })),
    };
  }
  async createFamily(name: string) {
    this.guard();
    const u = this.requireUser();
    if (this.members.some((m) => m.userId === u.id)) throw new SyncError('already_in_family');
    const id = this.id('family');
    this.families.set(id, { id, name: name.trim() || '我的家庭', ownerId: u.id });
    this.members.push({ familyId: id, userId: u.id, email: u.email, joinedAt: new Date(this.now()).toISOString() });
    return id;
  }
  async createInvite(): Promise<Invite> {
    this.guard();
    const u = this.requireUser();
    const m = this.members.find((x) => x.userId === u.id);
    if (!m) throw new SyncError('not_in_family');
    let code = '';
    for (let i = 0; i < 10; i++) code += INVITE_ALPHABET[(this.seq * 31 + i * 7) % INVITE_ALPHABET.length];
    this.seq += 1;
    const expiresAt = this.now() + 7 * 86_400_000;
    this.invites.set(code, { familyId: m.familyId, expiresAt });
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }
  async joinFamily(input: string) {
    this.guard();
    const u = this.requireUser();
    if (this.members.some((m) => m.userId === u.id)) throw new SyncError('already_in_family');
    const code = normalizeInviteCode(input);
    const inv = this.invites.get(code);
    if (!inv || inv.expiresAt <= this.now()) throw new SyncError('invalid_invite');
    this.members.push({ familyId: inv.familyId, userId: u.id, email: u.email, joinedAt: new Date(this.now()).toISOString() });
    this.invites.delete(code);
    return inv.familyId;
  }
}

export function memoryFamilyCache() {
  const map = new Map<string, FamilySnapshot | null>();
  return {
    get: (uid: string) => map.get(uid) ?? null,
    set: (uid: string, s: FamilySnapshot | null) => void map.set(uid, s),
    clear: () => map.clear(),
  };
}
