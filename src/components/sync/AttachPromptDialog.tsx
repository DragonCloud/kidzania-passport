import { useState } from 'react';
import { useSyncAccount } from '../../sync/SyncProvider';
import { ConfirmDialog } from '../ConfirmDialog';

/**
 * 加入家庭時，這支手機已經有紀錄：讓使用者選「合併（上傳本機紀錄）」或「捨棄本機、改用家庭資料」。
 * 孩子資料一律以家庭為準。
 */
export function AttachPromptDialog() {
  const { attachPrompt, actions } = useSyncAccount();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!attachPrompt) return null;

  const choose = (mode: 'merge' | 'discard') => {
    setBusy(true);
    void actions.chooseAttach(mode).finally(() => {
      setBusy(false);
      setConfirmDiscard(false);
    });
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="這支手機已有紀錄">
      <div className="absolute inset-0 bg-ink/50" />
      <div className="relative w-full max-w-sm rounded-3xl bg-paper p-5 shadow-2xl">
        <h2 className="text-lg font-black">
          {attachPrompt.completions > 0 ? `這支手機已有 ${attachPrompt.completions} 筆蓋章紀錄` : '這支手機已有本機紀錄'}
        </h2>
        <p className="mt-2 text-sm text-ink/70">
          你已加入「{attachPrompt.familyName}」。要怎麼處理這支手機原本的蓋章、照片與 kidZos 帳目？孩子的名字與生日會以家庭為準。
        </p>
        <button type="button" disabled={busy} onClick={() => choose('merge')} className="mt-4 w-full rounded-2xl bg-brand p-3 text-left text-white disabled:opacity-60">
          <span className="block font-bold">合併（建議）</span>
          <span className="block text-xs text-white/80">把這支手機的蓋章、照片與帳目上傳，和家人的紀錄放在一起</span>
        </button>
        <button type="button" disabled={busy} onClick={() => setConfirmDiscard(true)} className="mt-2 w-full rounded-2xl bg-white p-3 text-left ring-1 ring-ink/15 disabled:opacity-60">
          <span className="block font-bold">捨棄本機、改用家庭資料</span>
          <span className="block text-xs text-ink/60">刪除這支手機原本的紀錄，只顯示家庭的紀錄（設定與本機官方地圖保留）</span>
        </button>
      </div>
      <ConfirmDialog
        open={confirmDiscard}
        title="確定捨棄這支手機的紀錄？"
        confirmLabel="捨棄並改用家庭資料"
        danger
        busy={busy}
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => choose('discard')}
      >
        <p>這支手機原本的蓋章、照片與帳目（共 {attachPrompt.localCount} 筆資料）會刪除，且不會上傳，無法復原。若不確定，請先到「設定 → 匯出備份 ZIP」。</p>
      </ConfirmDialog>
    </div>
  );
}
