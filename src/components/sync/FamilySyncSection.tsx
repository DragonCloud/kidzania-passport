import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { db } from '../../db/db';
import { formatInviteCode, isValidEmail, isValidInviteCode, normalizeInviteCode, type Invite } from '../../sync/backend';
import { syncConfig } from '../../sync/client';
import { SyncError } from '../../sync/errors';
import { useSyncAccount } from '../../sync/SyncProvider';
import { formatDateTime } from '../../lib/format';
import { ConfirmDialog } from '../ConfirmDialog';
import { IconAlert } from '../icons';
import { SyncStatusCard } from './SyncStatusCard';

const inputCls =
  'mt-1 w-full rounded-xl bg-paper px-3 py-2.5 text-base ring-1 ring-ink/15 outline-none focus:ring-2 focus:ring-brand';
const primaryBtn = 'w-full rounded-2xl bg-brand py-3 font-bold text-white disabled:opacity-60';
const secondaryBtn = 'w-full rounded-2xl bg-white py-3 font-bold ring-1 ring-ink/15 disabled:opacity-60';
const MIN_SIGNUP_PASSWORD = 8;

function errorText(e: unknown): string {
  return e instanceof SyncError ? e.message : '發生未預期的錯誤，請稍後再試。';
}

function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-red-50 p-2.5 text-sm text-red-800 ring-1 ring-red-200" role="alert">
      <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** 設定頁「家庭同步」區塊：依狀態顯示未啟用／未登入／無家庭／已在家庭 */
export function FamilySyncSection({ onMessage }: { onMessage: (m: string) => void }) {
  const { state } = useSyncAccount();
  switch (state.status) {
    case 'disabled':
      return <DisabledPanel />;
    case 'loading':
      return <p className="py-6 text-center text-sm text-ink/50">讀取中…</p>;
    case 'signedOut':
      return <AuthPanel onMessage={onMessage} />;
    case 'noFamily':
      return <NoFamilyPanel email={state.user.email} onMessage={onMessage} />;
    case 'unknownFamily':
      return <UnknownFamilyPanel email={state.user.email} error={state.error} />;
    case 'inFamily':
      return <InFamilyPanel onMessage={onMessage} />;
  }
}

function DisabledPanel() {
  const secret = !syncConfig.enabled && syncConfig.reason === 'secret-key';
  return (
    <div>
      <p className="font-bold">此版本未啟用同步</p>
      <p className="mt-1 text-sm text-ink/65">
        所有紀錄、照片與 kidZos 帳目只存在這支手機。要和家人共用，請到「備份與還原」匯出 ZIP，或由管理者依 README 的「啟用同步」設定後重新部署。
      </p>
      {secret && <ErrorBox>設定的金鑰看起來是 service_role／secret key，為了安全已停用同步。請改用 anon（publishable）key。</ErrorBox>}
    </div>
  );
}

function SignedInAs({ email, onMessage }: { email: string | null; onMessage: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="min-w-0 flex-1 truncate text-ink/65">
        已登入：<b className="text-ink">{email ?? '（無 email）'}</b>
      </span>
      <button type="button" onClick={() => setOpen(true)} className="shrink-0 rounded-full px-3 py-1.5 font-bold text-ink/70 ring-1 ring-ink/15">
        登出
      </button>
      <SignOutDialog open={open} onClose={() => setOpen(false)} onMessage={onMessage} />
    </div>
  );
}

/** 登出確認：已接上家庭同步時，一併清除本機快取（雲端保留）；有未上傳資料時警告 */
export function SignOutDialog({ open, onClose, onMessage }: { open: boolean; onClose: () => void; onMessage: (m: string) => void }) {
  const { actions } = useSyncAccount();
  const pending = useLiveQuery(() => db.outbox.count(), [], 0);
  const attached = useLiveQuery(async () => !!(await db.syncState.get('familyId')), [], false);
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmDialog
      open={open}
      title={attached ? '登出並清除本機快取？' : '登出這支手機？'}
      confirmLabel={attached ? '登出並清除' : '登出'}
      danger={attached && pending > 0}
      busy={busy}
      onCancel={onClose}
      onConfirm={() => {
        setBusy(true);
        void actions
          .signOut()
          .then(
            () => onMessage(attached ? '已登出，並清除這支手機的家庭資料' : '已登出'),
            (e: unknown) => onMessage(errorText(e)),
          )
          .finally(() => {
            setBusy(false);
            onClose();
          });
      }}
    >
      {attached ? (
        <>
          <p>這支手機上的家庭紀錄、照片與帳目會清除；雲端資料保留，重新登入後會再下載。設定與本機官方地圖保留。</p>
          {pending > 0 && (
            <p className="mt-2 rounded-xl bg-red-50 p-2.5 font-bold text-red-800 ring-1 ring-red-200">
              還有 {pending} 筆尚未上傳，登出後會遺失。請先連上網路並按「立即同步」。
            </p>
          )}
        </>
      ) : (
        <p>登出後這支手機不會與家人同步。本機紀錄會保留。</p>
      )}
    </ConfirmDialog>
  );
}

// ───────────────────────── 未登入 ─────────────────────────

function AuthPanel({ onMessage }: { onMessage: (m: string) => void }) {
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  return (
    <div>
      <p className="text-sm text-ink/65">登入後可以和家人共用蓋章紀錄與照片，兩支手機都能看、都能蓋章，離線時也能用。</p>
      {mode === 'password' ? <PasswordForm onMessage={onMessage} /> : <OtpForm onMessage={onMessage} />}
      <button type="button" onClick={() => setMode(mode === 'password' ? 'otp' : 'password')} className="mt-3 w-full text-center text-sm font-bold text-brand underline">
        {mode === 'password' ? '改用 email 驗證碼登入' : '改用 email＋密碼登入'}
      </button>
    </div>
  );
}

function PasswordForm({ onMessage }: { onMessage: (m: string) => void }) {
  const { actions } = useSyncAccount();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'in' | 'up' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(kind: 'in' | 'up', e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    if (!isValidEmail(email.trim())) return setError('請輸入正確的 email。');
    if (!password) return setError('請輸入密碼。');
    if (kind === 'up' && password.length < MIN_SIGNUP_PASSWORD) return setError(`註冊密碼請至少 ${MIN_SIGNUP_PASSWORD} 個字元。`);
    setBusy(kind);
    try {
      if (kind === 'in') await actions.signIn(email, password);
      else await actions.signUp(email, password);
      onMessage(kind === 'in' ? '已登入' : '註冊完成，已登入');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={(e) => void submit('in', e)} className="mt-3">
      <label className="block">
        <span className="text-sm font-bold text-ink/70">Email</span>
        <input type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
      </label>
      <label className="mt-3 block">
        <span className="text-sm font-bold text-ink/70">密碼</span>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
      </label>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="submit" disabled={!!busy} className={primaryBtn}>
          {busy === 'in' ? '登入中…' : '登入'}
        </button>
        <button type="button" disabled={!!busy} onClick={() => void submit('up')} className={secondaryBtn}>
          {busy === 'up' ? '註冊中…' : '註冊'}
        </button>
      </div>
      <p className="mt-2 text-xs text-ink/45">第一次使用請按「註冊」（密碼至少 {MIN_SIGNUP_PASSWORD} 個字元）。兩人都註冊好後，管理者會關閉註冊。</p>
    </form>
  );
}

function OtpForm({ onMessage }: { onMessage: (m: string) => void }) {
  const { actions } = useSyncAccount();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    if (!isValidEmail(email.trim())) return setError('請輸入正確的 email。');
    setBusy(true);
    try {
      await actions.sendOtp(email);
      setSentTo(email.trim());
      setCooldown(60);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) return setError('請輸入信中的 6 位數驗證碼。');
    setBusy(true);
    try {
      await actions.verifyOtp(sentTo ?? email, code);
      onMessage('已登入');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!sentTo) {
    return (
      <form onSubmit={(e) => void send(e)} className="mt-3">
        <label className="block">
          <span className="text-sm font-bold text-ink/70">Email</span>
          <input type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </label>
        {error && <ErrorBox>{error}</ErrorBox>}
        <button type="submit" disabled={busy} className={`${primaryBtn} mt-4`}>
          {busy ? '寄送中…' : '寄送 6 位數驗證碼'}
        </button>
        <p className="mt-2 text-xs text-ink/45">只適用已註冊的帳號。驗證碼請回到這個 App 輸入，不要點信中的連結。</p>
      </form>
    );
  }
  return (
    <form onSubmit={(e) => void verify(e)} className="mt-3">
      <p className="text-sm">
        驗證碼已寄到 <b>{sentTo}</b>，1 小時內有效。
      </p>
      <label className="mt-3 block">
        <span className="text-sm font-bold text-ink/70">6 位數驗證碼</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className={`${inputCls} text-center text-2xl font-black tracking-[0.5em] tabular-nums`}
        />
      </label>
      {error && <ErrorBox>{error}</ErrorBox>}
      <button type="submit" disabled={busy} className={`${primaryBtn} mt-4`}>
        {busy ? '驗證中…' : '驗證並登入'}
      </button>
      <div className="mt-2 flex justify-between text-sm">
        <button type="button" onClick={() => { setSentTo(null); setCode(''); setError(null); }} className="font-bold text-ink/60">
          換一個 email
        </button>
        <button type="button" disabled={cooldown > 0 || busy} onClick={() => void send()} className="font-bold text-brand disabled:text-ink/35">
          {cooldown > 0 ? `${cooldown} 秒後可重寄` : '重新寄送'}
        </button>
      </div>
    </form>
  );
}

// ───────────────────────── 已登入、無家庭 ─────────────────────────

function NoFamilyPanel({ email, onMessage }: { email: string | null; onMessage: (m: string) => void }) {
  const { actions } = useSyncAccount();
  const [name, setName] = useState('我的家庭');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<{ where: 'create' | 'join'; text: string } | null>(null);
  const normalized = normalizeInviteCode(code);

  async function run(where: 'create' | 'join') {
    setError(null);
    if (where === 'join' && !isValidInviteCode(normalized)) return setError({ where, text: '邀請碼是 10 個英數字（不含 0、O、1、I）。' });
    setBusy(where);
    try {
      if (where === 'create') await actions.createFamily(name);
      else await actions.joinFamily(normalized);
      onMessage(where === 'create' ? '家庭已建立' : '已加入家庭');
    } catch (e) {
      setError({ where, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <SignedInAs email={email} onMessage={onMessage} />
      <p className="mt-3 text-sm text-ink/65">第一位家人建立家庭，再產生邀請碼給另一位家人加入。</p>

      <div className="mt-3 rounded-2xl bg-paper p-3">
        <h3 className="text-sm font-bold">建立新家庭</h3>
        <label className="mt-2 block">
          <span className="text-xs text-ink/55">家庭名稱</span>
          <input type="text" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} bg-white`} />
        </label>
        {error?.where === 'create' && <ErrorBox>{error.text}</ErrorBox>}
        <button type="button" disabled={!!busy} onClick={() => void run('create')} className={`${primaryBtn} mt-3`}>
          {busy === 'create' ? '建立中…' : '建立家庭'}
        </button>
      </div>

      <div className="mt-3 rounded-2xl bg-paper p-3">
        <h3 className="text-sm font-bold">用邀請碼加入</h3>
        <input
          type="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="ABCDE-FGHJK"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-label="邀請碼"
          className={`${inputCls} bg-white text-center text-xl font-black tracking-widest uppercase placeholder:font-medium placeholder:text-ink/25`}
        />
        {error?.where === 'join' && <ErrorBox>{error.text}</ErrorBox>}
        <button type="button" disabled={!!busy} onClick={() => void run('join')} className={`${secondaryBtn} mt-3`}>
          {busy === 'join' ? '加入中…' : '加入家庭'}
        </button>
      </div>
    </div>
  );
}

function UnknownFamilyPanel({ email, error }: { email: string | null; error: SyncError }) {
  const { actions } = useSyncAccount();
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <SignedInAs email={email} onMessage={() => undefined} />
      <ErrorBox>無法確認家庭資料：{error.message}</ErrorBox>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void actions.refresh().catch(() => undefined).finally(() => setBusy(false));
        }}
        className={`${secondaryBtn} mt-3`}
      >
        {busy ? '重試中…' : '重試'}
      </button>
    </div>
  );
}

// ───────────────────────── 已在家庭 ─────────────────────────

function InFamilyPanel({ onMessage }: { onMessage: (m: string) => void }) {
  const { state, sync, actions } = useSyncAccount();
  const pending = useLiveQuery(() => db.outbox.count(), [], 0);
  // 打開設定頁時重讀家庭成員（例如家人剛加入）
  useEffect(() => {
    void actions.refresh().catch(() => undefined);
  }, [actions]);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (state.status !== 'inFamily') return null;
  const { user, snapshot, offline } = state;

  async function makeInvite() {
    setBusy(true);
    setError(null);
    try {
      setInvite(await actions.createInvite());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      onMessage('邀請碼已複製');
    } catch {
      onMessage('無法複製，請手動抄下邀請碼');
    }
  }

  const shareText = invite
    ? `加入「${snapshot.family.name}」的 KidZania 職業護照：在 App「設定 → 家庭同步」登入後，輸入邀請碼 ${formatInviteCode(invite.code)}（${formatDateTime(Date.parse(invite.expiresAt))} 前有效）`
    : '';

  return (
    <div>
      <SignedInAs email={user.email} onMessage={onMessage} />

      <div className="mt-3 flex items-baseline justify-between">
        <h3 className="text-lg font-black">{snapshot.family.name}</h3>
        <span className="text-xs text-ink/50">{snapshot.members.length} 位成員</span>
      </div>
      <ul className="mt-1.5 divide-y divide-ink/5 rounded-2xl bg-paper px-3">
        {snapshot.members.map((m) => (
          <li key={m.userId} className="flex items-center gap-2 py-2.5 text-sm">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-black text-brand">
              {(m.email ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate">{m.email ?? '（無 email）'}</span>
            {m.userId === user.id && <span className="text-xs font-bold text-ink/45">你</span>}
            {m.userId === snapshot.family.ownerId && <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11px] font-bold text-ink/60">建立者</span>}
          </li>
        ))}
      </ul>

      <div className="mt-3">
        {invite ? (
          <div className="rounded-2xl bg-white p-3 text-center ring-2 ring-brand/30">
            <p className="text-xs text-ink/55">邀請碼（用過即失效）</p>
            <p className="mt-1 text-3xl font-black tracking-widest tabular-nums select-all">{formatInviteCode(invite.code)}</p>
            <p className="mt-1 text-xs text-ink/55">{formatDateTime(Date.parse(invite.expiresAt))} 前有效</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => void copy(invite.code)} className={secondaryBtn}>
                複製
              </button>
              <button
                type="button"
                onClick={() => {
                  if (navigator.share) void navigator.share({ text: shareText }).catch(() => undefined);
                  else void copy(shareText);
                }}
                className={primaryBtn}
              >
                分享
              </button>
            </div>
          </div>
        ) : (
          <button type="button" disabled={busy || offline} onClick={() => void makeInvite()} className={secondaryBtn}>
            {busy ? '產生中…' : '產生邀請碼給家人'}
          </button>
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>

      <div className="mt-3">
        <SyncStatusCard sync={sync} pending={pending} cachedOffline={offline} onSyncNow={() => void actions.syncNow()} />
      </div>
    </div>
  );
}
