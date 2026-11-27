import { frameFraction } from '../../config/defaults';
import { useBlobUrl } from '../../hooks/useBlobUrl';
import type { Floor } from '../../types/models';

/**
 * 使用者在「這支手機」自行載入的官方地圖（整頁圖，例如 PDF 以 300 dpi 輸出的 3509×2481）。
 * 依取景框裁切，讓 x,y 圖釘疊在相同位置。圖檔只存在 IndexedDB，不在網站裡。
 * 若上傳的圖不是整頁比例，位置會有偏差（第二階段再做手動對位）。
 */
export function OfficialMapImage({ floor, blobId }: { floor: Floor; blobId: string }) {
  const url = useBlobUrl(blobId);
  const f = frameFraction(floor);
  if (!url) return null;
  return (
    <div className="absolute inset-0 overflow-hidden bg-white">
      <img
        src={url}
        alt={`${floor} 樓官方地圖（本機）`}
        draggable={false}
        className="absolute max-w-none select-none"
        style={{
          width: `${100 / f.width}%`,
          left: `${(-f.left / f.width) * 100}%`,
          top: `${(-f.top / f.height) * 100}%`,
        }}
      />
    </div>
  );
}
