import { useEffect, useState } from 'react';
import { todayISO } from '../lib/age';

/** 當日日期；跨過午夜或 App 回到前景時自動更新（年齡依當天計算） */
export function useToday(): string {
  const [today, setToday] = useState(todayISO);
  useEffect(() => {
    const tick = () => setToday((prev) => {
      const now = todayISO();
      return now === prev ? prev : now;
    });
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return today;
}
