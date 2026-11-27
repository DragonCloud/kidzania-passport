import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { SETTING_DEFAULTS, type SettingValues } from '../lib/settings';

export function useSetting<K extends keyof SettingValues>(key: K): SettingValues[K] {
  const row = useLiveQuery(() => db.settings.get(key), [key]);
  return row === undefined ? SETTING_DEFAULTS[key] : (row.value as SettingValues[K]);
}
