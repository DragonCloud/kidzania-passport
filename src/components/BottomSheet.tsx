import { useEffect, type ReactNode } from 'react';
import { IconClose } from './icons';

/** 手機底部滑出面板：點背景或按 Esc 關閉，開啟時鎖住背景捲動 */
export function BottomSheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-ink/40" aria-label="關閉" onClick={onClose} />
      <div className="safe-bottom relative flex max-h-[88dvh] flex-col rounded-t-3xl bg-paper shadow-2xl">
        <div className="px-5 pt-3">
          <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-ink/15" />
          <div className="flex items-center justify-between gap-2">
            <h2 className="min-w-0 flex-1 text-lg font-bold">{title}</h2>
            <button type="button" onClick={onClose} className="-mr-2 p-2 text-xl text-ink/60" aria-label="關閉">
              <IconClose />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="border-t border-ink/5 px-5 pt-3 pb-3">{footer}</div>}
      </div>
    </div>
  );
}
