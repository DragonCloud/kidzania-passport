import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { currentLevel, expiryStatus, isPassportValidOn, levelOn, stampProgress, type StampProgress } from '../lib/passport';
import type { CitizenPassport, PassportLevel } from '../types/models';
import { useChild } from './useChild';
import { useToday } from './useToday';

export interface PassportState {
  loaded: boolean;
  passport: CitizenPassport | null;
  birthday: string | null;
  today: string;
  expiry: ReturnType<typeof expiryStatus>;
  /** 今天護照有效 */
  validToday: boolean;
  /** 今天的等級（無效時為 null） */
  levelToday: PassportLevel | null;
  /** 護照上記錄的目前等級（不論是否過期） */
  level: PassportLevel | null;
  progress: StampProgress | null;
  /** 舊護照沒有辦理時間（v0.3.0 建立）：需要一鍵修正 */
  needsIssuedAt: boolean;
}

export function usePassport(): PassportState {
  const { loaded, child } = useChild();
  const today = useToday();
  const passport = child.passport ?? null;
  const completions = useLiveQuery(() => (passport ? db.completions.toArray() : []), [!!passport], []);
  const validToday = isPassportValidOn(passport, child.birthday, today);
  return {
    loaded,
    passport,
    birthday: child.birthday,
    today,
    expiry: expiryStatus(child.birthday, today),
    validToday,
    levelToday: validToday ? levelOn(passport, today) : null,
    level: passport ? currentLevel(passport) : null,
    progress: passport ? stampProgress(passport, completions, child.birthday) : null,
    needsIssuedAt: !!passport && passport.issuedAt === undefined,
  };
}
