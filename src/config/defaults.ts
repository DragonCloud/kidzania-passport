import type { ChildProfile, Floor } from '../types/models';

/**
 * 注意：此 repo 是公開的。這裡不可寫入孩子的姓名、生日或任何個資，
 * 一律在首次開啟時由使用者輸入，只存在該裝置的 IndexedDB。
 */
export const EMPTY_CHILD: ChildProfile = { id: 'kid', name: '', birthday: null };

/** 官網「起始資金」：每次入園每位孩子 50 kidZos */
export const STARTING_KIDZOS = 50;

export const OFFICIAL_SITE = 'https://taipei.kidzania.com/tw-zh';

/**
 * 官方城市地圖 PDF 以 300 dpi 渲染（3509×2481 px）時的各樓層取景框 [left, top, right, bottom]。
 * jobs/facilities 的 x,y 皆是相對此框的 0–1 座標。
 * 本機載入官方圖時，用這個框裁切；自繪簡圖的 viewBox 也維持相同長寬比。
 */
export const OFFICIAL_PAGE_PX = { width: 3509, height: 2481 } as const;

export const MAP_FRAMES: Record<Floor, readonly [number, number, number, number]> = {
  1: [80, 220, 2680, 1760],
  2: [120, 260, 3380, 1920],
};

export function frameSize(floor: Floor): { width: number; height: number } {
  const [l, t, r, b] = MAP_FRAMES[floor];
  return { width: r - l, height: b - t };
}

/** 取景框在整頁中的比例位置（0–1），供裁切使用者上傳的官方圖 */
export function frameFraction(floor: Floor): { left: number; top: number; width: number; height: number } {
  const [l, t, r, b] = MAP_FRAMES[floor];
  const { width: W, height: H } = OFFICIAL_PAGE_PX;
  return { left: l / W, top: t / H, width: (r - l) / W, height: (b - t) / H };
}
