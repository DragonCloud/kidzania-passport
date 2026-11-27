import { describe, expect, it } from 'vitest';
import { resolveAccount } from './account';
import { formatInviteCode, isValidEmail, isValidInviteCode, normalizeInviteCode } from './backend';
import { readSyncConfig } from './client';
import { isNetworkError, mapAuthError, mapDbError, SyncError } from './errors';
import { MemoryAccountBackend, memoryFamilyCache } from './testing/memoryBackend';

// 測試用假值（非真實專案）
const URL_OK = 'https://example-project.supabase.co';
const fakeJwt = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.y`;

describe('readSyncConfig：syncEnabled 判斷', () => {
  it('缺少任一變數 → 停用', () => {
    expect(readSyncConfig({})).toEqual({ enabled: false, reason: 'missing' });
    expect(readSyncConfig({ VITE_SUPABASE_URL: URL_OK })).toEqual({ enabled: false, reason: 'missing' });
    expect(readSyncConfig({ VITE_SUPABASE_ANON_KEY: 'sb_publishable_x' })).toEqual({ enabled: false, reason: 'missing' });
    expect(readSyncConfig({ VITE_SUPABASE_URL: '  ', VITE_SUPABASE_ANON_KEY: ' ' })).toEqual({ enabled: false, reason: 'missing' });
  });
  it('兩者齊全 → 啟用（去空白、只留 origin）', () => {
    expect(readSyncConfig({ VITE_SUPABASE_URL: ` ${URL_OK}/ `, VITE_SUPABASE_ANON_KEY: ' sb_publishable_abc ' })).toEqual({
      enabled: true,
      config: { url: URL_OK, anonKey: 'sb_publishable_abc' },
    });
    expect(readSyncConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: fakeJwt('anon') }).enabled).toBe(true);
    expect(readSyncConfig({ VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_ANON_KEY: 'k' }).enabled).toBe(true);
  });
  it('誤填 service_role／secret key → 拒絕啟用', () => {
    expect(readSyncConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: 'sb_secret_abc' })).toEqual({ enabled: false, reason: 'secret-key' });
    expect(readSyncConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: fakeJwt('service_role') })).toEqual({
      enabled: false,
      reason: 'secret-key',
    });
  });
  it('網址不合法或非 https → 停用', () => {
    expect(readSyncConfig({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_ANON_KEY: 'k' }).enabled).toBe(false);
    expect(readSyncConfig({ VITE_SUPABASE_URL: 'http://example-project.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' }).enabled).toBe(false);
  });
  it('測試環境（沒有 .env.local）預設停用', async () => {
    const { syncEnabled } = await import('./client');
    expect(syncEnabled).toBe(false);
  });
});

describe('錯誤中文化', () => {
  it('Auth 錯誤代碼', () => {
    expect(mapAuthError({ code: 'signup_disabled', status: 422, message: 'Signups not allowed for this instance' }).code).toBe('signup_disabled');
    expect(mapAuthError({ code: 'otp_disabled', status: 422, message: 'Signups not allowed for otp' }).code).toBe('user_not_found');
    expect(mapAuthError({ code: 'invalid_credentials', status: 400 }).code).toBe('invalid_credentials');
    expect(mapAuthError({ code: 'otp_expired', status: 403 }).code).toBe('otp_invalid');
    expect(mapAuthError({ code: 'over_email_send_rate_limit', status: 429 }).code).toBe('otp_rate_limit');
    expect(mapAuthError({ code: 'user_already_exists', status: 422 }).code).toBe('user_exists');
    expect(mapAuthError({ message: 'Signups not allowed for this instance', status: 422 }).code).toBe('signup_disabled');
    expect(mapAuthError({ message: '???', status: 400 }).code).toBe('unknown');
  });
  it('關閉註冊時顯示清楚的中文說明', () => {
    const e = mapAuthError({ code: 'signup_disabled', status: 422 });
    expect(e.message).toContain('已關閉註冊');
    expect(e.message).toContain('Allow new users to sign up');
  });
  it('網路／暫停一律視為離線', () => {
    expect(isNetworkError({ name: 'AuthRetryableFetchError', status: 0 })).toBe(true);
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError({ status: 503, message: 'Service Unavailable' })).toBe(true);
    expect(isNetworkError({ status: 400 })).toBe(false);
    expect(mapAuthError({ name: 'AuthRetryableFetchError', status: 0 }).code).toBe('network');
  });
  it('RPC 錯誤', () => {
    expect(mapDbError({ code: 'P0001', message: 'already in a family' }).code).toBe('already_in_family');
    expect(mapDbError({ code: 'P0001', message: 'invalid or expired code' }).code).toBe('invalid_invite');
    expect(mapDbError({ code: 'P0001', message: 'not in a family' }).code).toBe('not_in_family');
  });
});

describe('邀請碼與 email 格式', () => {
  it('正規化與檢查', () => {
    expect(normalizeInviteCode(' abcde-fghjk ')).toBe('ABCDEFGHJK');
    expect(isValidInviteCode('ABCDEFGHJK')).toBe(true);
    expect(isValidInviteCode('ABCDEFGHJ0')).toBe(false); // 0 不在字元表
    expect(isValidInviteCode('ABC')).toBe(false);
    expect(formatInviteCode('ABCDEFGHJK')).toBe('ABCDE-FGHJK');
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('a@b')).toBe(false);
  });
});

describe('帳號狀態（記憶體後端）', () => {
  it('未登入 → 註冊 → 無家庭 → 建立家庭 → 已在家庭', async () => {
    const be = new MemoryAccountBackend();
    const cache = memoryFamilyCache();
    expect(await resolveAccount(be, await be.getUser(), cache)).toEqual({ status: 'signedOut' });
    const a = await be.signUp('Parent-A@Example.com', 'password-123');
    expect(a.email).toBe('parent-a@example.com');
    expect((await resolveAccount(be, a, cache)).status).toBe('noFamily');
    await be.createFamily('測試家庭');
    const s = await resolveAccount(be, a, cache);
    expect(s.status).toBe('inFamily');
    if (s.status === 'inFamily') {
      expect(s.snapshot.family.name).toBe('測試家庭');
      expect(s.snapshot.members.map((m) => m.email)).toEqual(['parent-a@example.com']);
      expect(s.offline).toBe(false);
    }
    await expect(be.createFamily('x')).rejects.toMatchObject({ code: 'already_in_family' });
  });

  it('邀請碼加入；用過即失效；過期失效', async () => {
    const be = new MemoryAccountBackend();
    const cache = memoryFamilyCache();
    await be.signUp('a@example.com', 'password-123');
    await be.createFamily('家');
    const inv = await be.createInvite();
    expect(isValidInviteCode(inv.code)).toBe(true);

    await be.signUp('b@example.com', 'password-456');
    await expect(be.joinFamily('ZZZZZZZZZZ')).rejects.toMatchObject({ code: 'invalid_invite' });
    await be.joinFamily(formatInviteCode(inv.code).toLowerCase());
    const b = (await be.getUser())!;
    const s = await resolveAccount(be, b, cache);
    expect(s.status === 'inFamily' && s.snapshot.members.length).toBe(2);

    await be.signUp('c@example.com', 'password-789');
    await expect(be.joinFamily(inv.code)).rejects.toMatchObject({ code: 'invalid_invite' });

    await be.signInWithPassword('a@example.com', 'password-123');
    const inv2 = await be.createInvite();
    const t0 = Date.now();
    be.now = () => t0 + 8 * 86_400_000;
    await be.signInWithPassword('c@example.com', 'password-789');
    await expect(be.joinFamily(inv2.code)).rejects.toMatchObject({ code: 'invalid_invite' });
  });

  it('關閉註冊後：註冊顯示中文說明；驗證碼不會建立新帳號，但既有帳號可用', async () => {
    const be = new MemoryAccountBackend();
    await be.signUp('a@example.com', 'password-123');
    await be.signOut();
    be.signupsEnabled = false;
    const err = await be.signUp('new@example.com', 'password-123').catch((e: SyncError) => e);
    expect(err).toBeInstanceOf(SyncError);
    expect((err as SyncError).message).toContain('已關閉註冊');
    await expect(be.sendEmailOtp('new@example.com')).rejects.toMatchObject({ code: 'user_not_found' });
    await be.sendEmailOtp('A@example.com');
    await expect(be.verifyEmailOtp('a@example.com', '000000')).rejects.toMatchObject({ code: 'otp_invalid' });
    const u = await be.verifyEmailOtp('a@example.com', be.lastOtp!.code);
    expect(u.email).toBe('a@example.com');
  });

  it('離線時用上次快取的家庭資料；沒有快取則顯示無法確認', async () => {
    const be = new MemoryAccountBackend();
    const cache = memoryFamilyCache();
    const a = await be.signUp('a@example.com', 'password-123');
    await be.createFamily('家');
    await resolveAccount(be, a, cache); // 寫入快取
    be.offline = true;
    const s = await resolveAccount(be, a, cache);
    expect(s.status === 'inFamily' && s.offline).toBe(true);
    cache.clear();
    const s2 = await resolveAccount(be, a, cache);
    expect(s2.status).toBe('unknownFamily');
    expect(s2.status === 'unknownFamily' && s2.error.code).toBe('network');
  });
});
