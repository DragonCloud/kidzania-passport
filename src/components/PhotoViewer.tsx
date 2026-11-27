import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useBlobUrl } from '../hooks/useBlobUrl';
import { formatDateTime } from '../lib/format';
import { jobById } from '../lib/jobs';
import type { Completion } from '../types/models';
import { IconClose } from './icons';

/** 全螢幕看照片 */
export function PhotoViewer({ completion, onClose }: { completion: Completion | null; onClose: () => void }) {
  const url = useBlobUrl(completion?.photoBlobId);
  useEffect(() => {
    if (!completion) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [completion, onClose]);
  if (!completion) return null;
  const job = jobById(completion.jobId);
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="照片">
      <div className="safe-top flex items-center justify-between px-3 py-2 text-white">
        <div className="min-w-0 px-1">
          <p className="truncate font-bold">{job?.nameZh ?? '職業體驗'}</p>
          <p className="text-xs text-white/60">{formatDateTime(completion.completedAt)}</p>
        </div>
        <button type="button" onClick={onClose} className="p-2 text-2xl" aria-label="關閉">
          <IconClose />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden" onClick={onClose}>
        {url ? <img src={url} alt={job?.nameZh ?? ''} className="max-h-full max-w-full object-contain" /> : <p className="text-white/50">載入中…</p>}
      </div>
      {completion.note && <p className="px-4 py-2 text-sm text-white/80">{completion.note}</p>}
      <div className="safe-bottom flex justify-center gap-3 p-3">
        <Link to={`/job/${completion.jobId}`} className="rounded-full bg-white/15 px-4 py-2 text-sm font-bold text-white">
          看職業
        </Link>
        <Link to={`/completion/${completion.id}/edit`} className="rounded-full bg-white/15 px-4 py-2 text-sm font-bold text-white">
          編輯紀錄
        </Link>
      </div>
    </div>
  );
}
