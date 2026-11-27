import type { PhotoPair } from './completions';

/** 原圖長邊上限與縮圖長邊（手機空間有限，照片只存本機） */
export const PHOTO_MAX_EDGE = 1600;
export const THUMB_MAX_EDGE = 360;

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* 某些格式（或舊版 Safari）不支援，改用 <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sizeOf(src: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  return 'naturalWidth' in src ? { w: src.naturalWidth, h: src.naturalHeight } : { w: src.width, h: src.height };
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('照片轉檔失敗'))), 'image/jpeg', quality),
  );
}

function render(src: ImageBitmap | HTMLImageElement, maxEdge: number, quality: number): Promise<Blob> {
  const { w, h } = sizeOf(src);
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法處理照片');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return toBlob(canvas, quality);
}

/** 拍照或選圖後：轉成 JPEG、縮小，並產生縮圖 */
export async function makePhotoPair(file: Blob): Promise<PhotoPair> {
  const src = await decode(file);
  try {
    const [full, thumb] = await Promise.all([render(src, PHOTO_MAX_EDGE, 0.85), render(src, THUMB_MAX_EDGE, 0.8)]);
    return { full, thumb };
  } finally {
    if ('close' in src) src.close();
  }
}

/** 官方地圖底圖：保留較高解析度（長邊 4000px），並回傳原圖尺寸供比例檢查 */
export async function prepareMapImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const src = await decode(file);
  try {
    const { w, h } = sizeOf(src);
    return { blob: await render(src, 4000, 0.9), width: w, height: h };
  } finally {
    if ('close' in src) src.close();
  }
}

/** 上傳前檢查：超過 1.5 MB 再壓一次（長邊 1600px、品質 0.7） */
export const UPLOAD_MAX_BYTES = 1.5 * 1024 * 1024;
export async function shrinkIfNeeded(b: Blob): Promise<Blob> {
  if (b.size <= UPLOAD_MAX_BYTES) return b;
  const src = await decode(b);
  try {
    return await render(src, PHOTO_MAX_EDGE, 0.7);
  } finally {
    if ('close' in src) src.close();
  }
}
