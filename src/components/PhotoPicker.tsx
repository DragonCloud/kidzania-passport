import { useEffect, useRef, useState } from 'react';
import { makePhotoPair } from '../lib/photo';
import type { PhotoPair } from '../lib/completions';

/**
 * 拍照或從相簿選圖。選好後立即壓縮成 JPEG（長邊 1600px）與縮圖，只交給呼叫端，不上傳。
 * existingUrl：編輯模式時已存的照片。
 */
export function PhotoPicker({
  value,
  existingUrl,
  onChange,
}: {
  value: PhotoPair | null | undefined;
  existingUrl?: string;
  /** PhotoPair＝新照片；null＝移除 */
  onChange: (v: PhotoPair | null) => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | undefined>();

  useEffect(() => {
    if (!value) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(value.full);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  async function handle(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await makePhotoPair(f));
    } catch {
      setError('這張照片無法讀取，請換一張試試');
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = '';
      if (libraryRef.current) libraryRef.current.value = '';
    }
  }

  // value===null 表示使用者移除了既有照片
  const shown = value === null ? undefined : (preview ?? existingUrl);

  return (
    <div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void handle(e.target.files)} />
      <input ref={libraryRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handle(e.target.files)} />
      {shown ? (
        <div className="relative overflow-hidden rounded-2xl bg-ink/5">
          <img src={shown} alt="體驗照片預覽" className="max-h-72 w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 flex gap-2 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8">
            <button type="button" onClick={() => libraryRef.current?.click()} className="rounded-full bg-white/90 px-3 py-1.5 text-sm font-bold">
              換一張
            </button>
            <button type="button" onClick={() => onChange(null)} className="rounded-full bg-white/90 px-3 py-1.5 text-sm font-bold text-red-700">
              移除
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => cameraRef.current?.click()}
            className="flex h-24 flex-col items-center justify-center gap-1 rounded-2xl bg-white text-sm font-bold ring-1 ring-ink/10 disabled:opacity-50"
          >
            <span className="text-2xl" aria-hidden="true">📷</span>拍照
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => libraryRef.current?.click()}
            className="flex h-24 flex-col items-center justify-center gap-1 rounded-2xl bg-white text-sm font-bold ring-1 ring-ink/10 disabled:opacity-50"
          >
            <span className="text-2xl" aria-hidden="true">🖼️</span>從相簿選
          </button>
        </div>
      )}
      {busy && <p className="mt-2 text-sm text-ink/60">照片處理中…</p>}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <p className="mt-1.5 text-[11px] text-ink/45">照片只存在這支手機，不會上傳。</p>
    </div>
  );
}
