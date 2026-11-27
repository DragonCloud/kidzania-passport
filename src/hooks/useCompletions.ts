import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../db/db';
import { statsByJob, type JobStats } from '../lib/completions';
import type { Completion } from '../types/models';

const EMPTY: Completion[] = [];

/** 全部完成紀錄（新→舊） */
export function useCompletions(): { loaded: boolean; completions: Completion[]; stats: Map<string, JobStats> } {
  const rows = useLiveQuery(() => db.completions.orderBy('completedAt').reverse().toArray(), [], null);
  const completions = rows ?? EMPTY;
  const stats = useMemo(() => statsByJob(completions), [completions]);
  return { loaded: rows !== null, completions, stats };
}

/** 單一職業的完成紀錄（新→舊） */
export function useJobCompletions(jobId: string | undefined): Completion[] {
  return (
    useLiveQuery(
      async () => (jobId ? (await db.completions.where('jobId').equals(jobId).sortBy('completedAt')).reverse() : EMPTY),
      [jobId],
    ) ?? EMPTY
  );
}
