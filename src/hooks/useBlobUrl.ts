import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo } from 'react';
import { db } from '../db/db';

/** 把 IndexedDB 裡的照片轉成可放進 <img> 的暫時網址，元件卸載時釋放 */
export function useBlobUrl(blobId: string | undefined | null): string | undefined {
  const blob = useLiveQuery(async () => (blobId ? (await db.blobs.get(blobId))?.data : undefined), [blobId]);
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : undefined), [blob]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url;
}
