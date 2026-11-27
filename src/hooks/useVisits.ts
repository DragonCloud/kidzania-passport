import { useLiveQuery } from 'dexie-react-hooks';
import { listVisits } from '../lib/visits';
import type { Visit } from '../types/models';

const EMPTY: Visit[] = [];

/** 全部入園紀錄（新→舊） */
export function useVisits(): Visit[] {
  return useLiveQuery(() => listVisits(), []) ?? EMPTY;
}
