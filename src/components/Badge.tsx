import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'pending' | 'locked' | 'done' | 'earn' | 'spend' | 'twd' | 'info';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ink/[0.06] text-ink/75',
  pending: 'bg-amber-100 text-amber-900 ring-1 ring-amber-300',
  locked: 'bg-stone-200 text-stone-600',
  done: 'bg-emerald-100 text-emerald-800',
  earn: 'bg-emerald-50 text-earn ring-1 ring-emerald-200',
  spend: 'bg-orange-50 text-spend ring-1 ring-orange-200',
  twd: 'bg-violet-50 text-twd ring-1 ring-violet-200',
  info: 'bg-sky-50 text-sky-800 ring-1 ring-sky-200',
};

export function Badge({ tone = 'neutral', icon, children }: { tone?: BadgeTone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}>
      {icon}
      {children}
    </span>
  );
}

/** 地圖編號圓章：1F 橘、2F 藍綠 */
export function MapNoBadge({
  mapNo,
  floor,
  size = 'md',
  inverse = false,
}: {
  mapNo: number | null;
  floor: number | null;
  size?: 'md' | 'lg';
  /** 放在彩色底上時改用白底彩字 */
  inverse?: boolean;
}) {
  const solid = floor === 2 ? 'bg-teal-600 text-white' : floor === 1 ? 'bg-brand text-white' : 'bg-stone-400 text-white';
  const inv = floor === 2 ? 'bg-white text-teal-700' : floor === 1 ? 'bg-white text-brand' : 'bg-white text-stone-500';
  const color = inverse ? inv : solid;
  const dim = size === 'lg' ? 'h-14 w-14 text-xl' : 'h-10 w-10 text-base';
  return (
    <span
      className={`${color} ${dim} inline-flex shrink-0 items-center justify-center rounded-full font-black tabular-nums shadow-sm`}
      aria-label={mapNo !== null ? `地圖編號 ${mapNo}` : '地圖編號未知'}
    >
      {mapNo ?? '?'}
    </span>
  );
}
