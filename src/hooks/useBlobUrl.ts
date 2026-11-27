import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../db/db';
import { getActiveEngine } from '../sync/runtime';

/**
 * 把 IndexedDB 裡的照片轉成可放進 <img> 的暫時網址，元件卸載時釋放。
 * fetchIfMissing：家庭同步時，若這張照片只有雲端中繼資料（原圖），就在需要時下載。
 */
export function useBlobUrl(blobId: string | undefined | null, opts: { fetchIfMissing?: boolean } = {}): string | undefined {
  return useBlobState(blobId, opts).url;
}

export function useBlobState(
  blobId: string | undefined | null,
  { fetchIfMissing = false }: { fetchIfMissing?: boolean } = {},
): { url?: string; downloading: boolean; failed: boolean } {
  const row = useLiveQuery(async () => (blobId ? ((await db.blobs.get(blobId)) ?? null) : null), [blobId]);
  const blob = row?.data;
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : undefined), [blob]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState(false);
  const needsDownload = !!row && !row.data && !!row.remotePath;
  useEffect(() => {
    if (!fetchIfMissing || !needsDownload || !blobId) return;
    const eng = getActiveEngine();
    if (!eng) return;
    let alive = true;
    setDownloading(true);
    setFailed(false);
    eng
      .ensureBlob(blobId)
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setDownloading(false));
    return () => {
      alive = false;
    };
  }, [fetchIfMissing, needsDownload, blobId]);

  return { url, downloading, failed };
}
