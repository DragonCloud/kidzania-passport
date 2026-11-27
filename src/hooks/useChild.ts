import { useLiveQuery } from 'dexie-react-hooks';
import { EMPTY_CHILD } from '../config/defaults';
import { db } from '../db/db';
import { ageParts, type AgeParts } from '../lib/age';
import type { ChildProfile } from '../types/models';
import { useToday } from './useToday';

export interface ChildState {
  loaded: boolean;
  child: ChildProfile;
  /** 顯示用名字；未設定時為「孩子」 */
  displayName: string;
  age: AgeParts | null;
  /** 滿歲；未設定生日為 null */
  years: number | null;
}

export function useChild(): ChildState {
  const today = useToday();
  const row = useLiveQuery(() => db.child.get('kid'), [], null);
  const loaded = row !== null;
  const child = row ?? EMPTY_CHILD;
  const age = child.birthday ? ageParts(child.birthday, today) : null;
  return {
    loaded,
    child,
    displayName: child.name || '孩子',
    age,
    years: age?.years ?? null,
  };
}
