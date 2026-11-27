/**
 * 同步相關錯誤：把 Supabase Auth／PostgREST／網路錯誤轉成固定代碼與中文說明。
 */
export type SyncErrorCode =
  | 'signup_disabled'
  | 'invalid_credentials'
  | 'user_exists'
  | 'weak_password'
  | 'email_invalid'
  | 'email_confirmation_required'
  | 'user_not_found'
  | 'otp_invalid'
  | 'otp_rate_limit'
  | 'rate_limit'
  | 'already_in_family'
  | 'not_in_family'
  | 'invalid_invite'
  | 'not_signed_in'
  | 'network'
  | 'unknown';

export const SYNC_ERROR_MESSAGES: Record<SyncErrorCode, string> = {
  signup_disabled: '這個網站已關閉註冊。請用已經建立好的帳號登入；若需要新帳號，請管理者到 Supabase 後台暫時開啟「Allow new users to sign up」。',
  invalid_credentials: 'Email 或密碼不正確。',
  user_exists: '這個 email 已經註冊過了，請直接登入。',
  weak_password: '密碼太簡單，請至少 8 個字元，並混用英文與數字。',
  email_invalid: 'Email 格式不正確。',
  email_confirmation_required: '這個 Supabase 專案仍開著「Confirm email」，註冊後需要收信確認。請管理者到後台 Authentication 關閉它。',
  user_not_found: '這個 email 還沒有帳號。請先用 email＋密碼註冊，或確認拼字。',
  otp_invalid: '驗證碼不正確或已過期（1 小時內有效），請重新寄送。',
  otp_rate_limit: '寄送太頻繁，請等 1 分鐘後再試。',
  rate_limit: '嘗試太多次，請稍候再試。',
  already_in_family: '這個帳號已經在一個家庭裡了。',
  not_in_family: '這個帳號還沒有加入家庭。',
  invalid_invite: '邀請碼不正確或已過期（7 天內有效、用過即失效），請請家人重新產生。',
  not_signed_in: '尚未登入。',
  network: '連不上雲端，請確認網路後再試。',
  unknown: '發生未預期的錯誤，請稍後再試。',
};

export class SyncError extends Error {
  readonly code: SyncErrorCode;
  readonly detail?: string;
  constructor(code: SyncErrorCode, detail?: string) {
    super(SYNC_ERROR_MESSAGES[code]);
    this.name = 'SyncError';
    this.code = code;
    this.detail = detail;
  }
}

interface ErrorLike {
  name?: string;
  code?: string;
  status?: number;
  message?: string;
}

function asErrorLike(e: unknown): ErrorLike {
  return typeof e === 'object' && e !== null ? (e as ErrorLike) : { message: String(e) };
}

/** 網路層錯誤（離線、DNS、專案暫停回 5xx） */
export function isNetworkError(e: unknown): boolean {
  const x = asErrorLike(e);
  if (x.name === 'AuthRetryableFetchError' || x.name === 'TypeError') return true;
  if (typeof x.status === 'number' && (x.status === 0 || x.status >= 500)) return true;
  return /failed to fetch|network|load failed|fetch failed/i.test(x.message ?? '');
}

/** Supabase Auth 錯誤 → SyncError */
export function mapAuthError(e: unknown): SyncError {
  if (e instanceof SyncError) return e;
  const x = asErrorLike(e);
  const msg = x.message ?? '';
  if (isNetworkError(e)) return new SyncError('network', msg);
  switch (x.code) {
    case 'signup_disabled':
      return new SyncError('signup_disabled', msg);
    case 'invalid_credentials':
      return new SyncError('invalid_credentials', msg);
    case 'user_already_exists':
    case 'email_exists':
      return new SyncError('user_exists', msg);
    case 'weak_password':
      return new SyncError('weak_password', msg);
    case 'email_address_invalid':
    case 'validation_failed':
      return new SyncError('email_invalid', msg);
    case 'email_not_confirmed':
      return new SyncError('email_confirmation_required', msg);
    // shouldCreateUser:false 且 email 不存在時，Supabase 回 otp_disabled（Signups not allowed for otp）
    case 'otp_disabled':
    case 'user_not_found':
      return new SyncError('user_not_found', msg);
    case 'otp_expired':
      return new SyncError('otp_invalid', msg);
    case 'over_email_send_rate_limit':
      return new SyncError('otp_rate_limit', msg);
    case 'over_request_rate_limit':
      return new SyncError('rate_limit', msg);
  }
  if (/signups? not allowed/i.test(msg)) return new SyncError(/otp/i.test(msg) ? 'user_not_found' : 'signup_disabled', msg);
  if (/invalid login credentials/i.test(msg)) return new SyncError('invalid_credentials', msg);
  if (/already registered/i.test(msg)) return new SyncError('user_exists', msg);
  if (/token has expired|invalid token|otp/i.test(msg)) return new SyncError('otp_invalid', msg);
  if (/rate limit/i.test(msg)) return new SyncError('rate_limit', msg);
  return new SyncError('unknown', msg);
}

/** PostgREST／RPC 錯誤 → SyncError（RPC 以 raise exception 的英文訊息區分） */
export function mapDbError(e: unknown): SyncError {
  if (e instanceof SyncError) return e;
  const x = asErrorLike(e);
  const msg = x.message ?? '';
  if (isNetworkError(e)) return new SyncError('network', msg);
  if (msg.includes('already in a family')) return new SyncError('already_in_family', msg);
  if (msg.includes('invalid or expired code')) return new SyncError('invalid_invite', msg);
  if (msg.includes('not in a family')) return new SyncError('not_in_family', msg);
  if (msg.includes('not signed in') || x.code === 'PGRST301' || x.status === 401) return new SyncError('not_signed_in', msg);
  return new SyncError('unknown', msg);
}
