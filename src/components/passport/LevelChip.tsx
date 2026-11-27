import { LEVEL_LABEL } from '../../lib/passport';
import type { PassportLevel } from '../../types/models';

const TONE: Record<PassportLevel, string> = {
  model: 'bg-sky-100 text-sky-900 ring-sky-200',
  outstanding: 'bg-amber-100 text-amber-900 ring-amber-200',
  honor: 'bg-violet-100 text-violet-900 ring-violet-200',
};

export function LevelChip({ level, small = false }: { level: PassportLevel; small?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-black ring-1 ${TONE[level]} ${small ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-sm'}`}>
      <span aria-hidden="true">{level === 'model' ? '★' : level === 'outstanding' ? '★★' : '★★★'}</span>
      {LEVEL_LABEL[level]}
    </span>
  );
}
