import { db, type AppDB } from '../db/db';
import type { SettingKey } from '../types/models';

export interface SettingValues {
  /** 使用者自行載入的官方地圖 blob id（只存本機） */
  officialMap1F: string | null;
  officialMap2F: string | null;
  /** 地圖上是否顯示廁所／ATM／AED 等服務圖示 */
  showServiceIcons: boolean;
  /** 蓋章音效 */
  soundOn: boolean;
  /** 上次匯出備份的時間（ms） */
  lastBackupAt: number | null;
}

export const SETTING_DEFAULTS: SettingValues = {
  officialMap1F: null,
  officialMap2F: null,
  showServiceIcons: true,
  soundOn: true,
  lastBackupAt: null,
};

export async function getSetting<K extends SettingKey>(key: K, d: AppDB = db): Promise<SettingValues[K]> {
  const row = await d.settings.get(key);
  return row === undefined ? SETTING_DEFAULTS[key] : (row.value as SettingValues[K]);
}

export async function setSetting<K extends SettingKey>(key: K, value: SettingValues[K], d: AppDB = db): Promise<void> {
  await d.settings.put({ key, value });
}
