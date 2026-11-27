import type { Eligibility } from '../lib/age';
import type { JobStats } from '../lib/completions';
import type { Job } from '../types/models';
import { Badge } from './Badge';
import { IconLock, IconStamp } from './icons';

/** 卡片與詳情共用的狀態標籤：已完成、待確認、年齡未知、未解鎖、身高 */
export function JobStatusBadges({ job, eligibility, stats }: { job: Job; eligibility: Eligibility; stats?: JobStats }) {
  return (
    <>
      {stats && (
        <Badge tone="done" icon={<IconStamp />}>
          已完成{stats.count > 1 ? ` ×${stats.count}` : ''}
        </Badge>
      )}
      {eligibility === 'unknown' ? (
        <Badge tone="pending">年齡未知・待確認</Badge>
      ) : (
        job.flag && <Badge tone="pending">待確認</Badge>
      )}
      {eligibility === 'locked' && (
        <Badge tone="locked" icon={<IconLock />}>
          {job.minAge} 歲解鎖
        </Badge>
      )}
      {eligibility === 'tooOld' && <Badge tone="locked">超過 {job.maxAge} 歲</Badge>}
      {job.heightReq && <Badge tone="info">身高 {job.heightReq}</Badge>}
    </>
  );
}
