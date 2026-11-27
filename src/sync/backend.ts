/**
 * 帳號與家庭的後端介面。正式版由 supabaseBackend 實作；測試用 testing/memoryBackend。
 * （S2 的資料同步另以 RemoteStore 介面實作。）
 * 所有方法失敗時都拋出 SyncError（見 errors.ts）。
 */
export interface AuthUser {
  id: string;
  email: string | null;
}

export interface FamilyInfo {
  id: string;
  name: string;
  /** 建立者；建立者帳號被刪除後為 null（家庭與紀錄仍保留） */
  ownerId: string | null;
}

export interface FamilyMember {
  userId: string;
  email: string | null;
  joinedAt: string;
}

export interface FamilySnapshot {
  family: FamilyInfo;
  members: FamilyMember[];
}

export interface Invite {
  code: string;
  expiresAt: string;
}

export interface AccountBackend {
  /** 目前登入者（讀本機 session，離線也可用） */
  getUser(): Promise<AuthUser | null>;
  onAuthChange(cb: (user: AuthUser | null) => void): () => void;
  signInWithPassword(email: string, password: string): Promise<AuthUser>;
  /** 後台已關閉 Confirm email，註冊後直接登入 */
  signUp(email: string, password: string): Promise<AuthUser>;
  /** 寄出 6 位數驗證碼（shouldCreateUser: false，不會建立新帳號） */
  sendEmailOtp(email: string): Promise<void>;
  verifyEmailOtp(email: string, token: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  /** null＝尚未加入任何家庭 */
  getMyFamily(userId: string): Promise<FamilySnapshot | null>;
  createFamily(name: string): Promise<string>;
  createInvite(): Promise<Invite>;
  joinFamily(code: string): Promise<string>;
}

/** 邀請碼字元（與 schema.sql 的 create_invite 相同，排除易混淆的 0/O/1/I） */
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 使用者輸入的邀請碼：去空白與連字號、轉大寫 */
export function normalizeInviteCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export function isValidInviteCode(code: string): boolean {
  return new RegExp(`^[${INVITE_ALPHABET}]{10}$`).test(code);
}

/** 顯示用：ABCDE-FGHJK */
export function formatInviteCode(code: string): string {
  return code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
