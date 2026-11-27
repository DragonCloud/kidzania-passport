import { useEffect, type ReactNode } from 'react';

/** 置中確認對話框（刪除等不可復原操作用） */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = '確定',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" role="alertdialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 bg-ink/50" aria-label="取消" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-3xl bg-paper p-5 shadow-2xl">
        <h2 className="text-lg font-bold">{title}</h2>
        {children && <div className="mt-2 text-sm text-ink/75">{children}</div>}
        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onCancel} className="flex-1 rounded-2xl bg-white py-3 font-bold ring-1 ring-ink/15">
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 rounded-2xl py-3 font-bold text-white disabled:opacity-60 ${danger ? 'bg-red-600' : 'bg-brand'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
