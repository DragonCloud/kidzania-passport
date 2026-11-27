import { db, newId, type AppDB } from '../db/db';
import type { Floor } from '../types/models';
import { getSetting, setSetting } from './settings';

const KEY = { 1: 'officialMap1F', 2: 'officialMap2F' } as const;

/**
 * 使用者自行載入的官方地圖（只存這支手機的 IndexedDB，不在網站、不在 repo）。
 * 圖片需為官方 PDF 的「整頁」輸出，才能對準圖釘。
 */
export async function saveOfficialMap(floor: Floor, image: Blob, d: AppDB = db): Promise<string> {
  const id = newId();
  await d.transaction('rw', d.blobs, d.settings, async () => {
    const old = await getSetting(KEY[floor], d);
    if (old) await d.blobs.delete(old);
    await d.blobs.add({ id, kind: 'official-map', mime: image.type || 'image/jpeg', data: image, createdAt: Date.now() });
    await setSetting(KEY[floor], id, d);
  });
  return id;
}

export async function removeOfficialMap(floor: Floor, d: AppDB = db): Promise<void> {
  await d.transaction('rw', d.blobs, d.settings, async () => {
    const old = await getSetting(KEY[floor], d);
    if (old) await d.blobs.delete(old);
    await setSetting(KEY[floor], null, d);
  });
}

/** 圖片長寬比與官方整頁（3509×2481 ≈ 1.414）差太多時提醒 */
export function looksLikeFullPage(width: number, height: number): boolean {
  const r = Math.max(width, height) / Math.min(width, height);
  return Math.abs(r - 3509 / 2481) < 0.06;
}
