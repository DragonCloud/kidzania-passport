import { useLiveQuery } from 'dexie-react-hooks';
import { visitForDate } from '../lib/visits';
import type { Visit } from '../types/models';
import { useToday } from './useToday';

/** 今天的入園紀錄；undefined＝今天還沒建立，null＝讀取中 */
export function useCurrentVisit(): Visit | undefined | null {
  const today = useToday();
  return useLiveQuery(() => visitForDate(today), [today], null);
}
