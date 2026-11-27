import { economyKind } from '../lib/jobs';
import { formatKidzos, formatNtd } from '../lib/format';
import type { Job } from '../types/models';
import { Badge } from './Badge';

/** 賺／付 kidZos、自費新臺幣；官方未列時顯示「收支未公布」，不自行補值 */
export function EconomyTag({ job }: { job: Pick<Job, 'kidzoDelta' | 'ntdFee'> }) {
  const kind = economyKind(job);
  if (kind === 'twd') return <Badge tone="twd">自費 {formatNtd(job.ntdFee!)}</Badge>;
  if (kind === 'earn') return <Badge tone="earn">賺 {formatKidzos(job.kidzoDelta!)}</Badge>;
  if (kind === 'spend') return <Badge tone="spend">付 {formatKidzos(-job.kidzoDelta!, false)}</Badge>;
  return <Badge tone="neutral">收支未公布</Badge>;
}
