import { useState, type FormEvent } from 'react';
import { requestPersistence } from '../db/persist';
import { isValidBirthday, todayISO } from '../lib/age';
import { saveChild } from '../lib/child';
import type { ChildProfile } from '../types/models';

/**
 * 首次開啟時輸入孩子名字與生日（只存在這支手機的 IndexedDB）。
 * 第 7 批的設定頁也會用同一個元件。
 */
export function ChildSetupCard({ child, onSaved, compact = false }: { child: ChildProfile; onSaved?: () => void; compact?: boolean }) {
  const [name, setName] = useState(child.name);
  const [birthday, setBirthday] = useState(child.birthday ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!isValidBirthday(birthday)) {
      setError('請選擇正確的生日');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveChild({ name, birthday });
      void requestPersistence();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className={compact ? '' : 'rounded-3xl bg-white p-4 shadow-sm ring-1 ring-brand/20'}>
      {!compact && (
        <>
          <h2 className="text-lg font-bold">先告訴我孩子的生日</h2>
          <p className="mt-1 text-sm text-ink/65">用來判斷現在能玩哪些職業。只存在這支手機，不會上傳。</p>
        </>
      )}
      <label className="mt-3 block">
        <span className="text-sm font-medium text-ink/70">名字（選填）</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：小名"
          maxLength={20}
          autoComplete="off"
          className="mt-1 w-full rounded-xl bg-paper px-3 py-2.5 text-base ring-1 ring-ink/15 outline-none focus:ring-2 focus:ring-brand"
        />
      </label>
      <label className="mt-3 block">
        <span className="text-sm font-medium text-ink/70">生日</span>
        <input
          type="date"
          value={birthday}
          max={todayISO()}
          onChange={(e) => setBirthday(e.target.value)}
          required
          className="mt-1 w-full rounded-xl bg-paper px-3 py-2.5 text-base ring-1 ring-ink/15 outline-none focus:ring-2 focus:ring-brand"
        />
      </label>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="mt-4 w-full rounded-2xl bg-brand py-3 font-bold text-white disabled:opacity-60"
      >
        {saving ? '儲存中…' : compact ? '儲存變更' : '儲存'}
      </button>
    </form>
  );
}
