import type { MapPin, PinState } from '../../lib/jobs';
import type { Facility } from '../../types/models';

export interface PinView {
  pin: MapPin;
  state: PinState;
}

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

function pinClasses(state: PinState, floor: number, selected: boolean, compact: boolean): string {
  const size = compact ? 'h-5 w-5 text-[9px]' : 'h-8 w-8 text-[13px]';
  const base = `absolute flex ${size} -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-black tabular-nums shadow-md transition-transform`;
  const sel = selected ? ' z-20 scale-125 ring-4 ring-ink/25' : ' z-10';
  const solid = floor === 2 ? 'bg-teal-600 text-white' : 'bg-brand text-white';
  switch (state.kind) {
    case 'done':
      return `${base}${sel} -rotate-12 ${compact ? 'border-2' : 'border-[3px]'} border-[#1d8a4a] bg-white text-[#1d8a4a]`;
    case 'partial':
      return `${base}${sel} ${solid} ring-2 ring-[#1d8a4a] ring-offset-1`;
    case 'locked':
      return `${base}${sel} bg-stone-300 text-stone-600`;
    default:
      return `${base}${sel} ${solid}`;
  }
}

/** 職業圖釘（HTML 疊在 SVG 上，縮放時大小固定、好點） */
export function PinLayer({
  pins,
  floor,
  compact = false,
  selectedKey,
  onSelect,
}: {
  pins: PinView[];
  floor: number;
  /** 全景縮放時用小圖釘 */
  compact?: boolean;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <>
      {pins.map(({ pin, state }) => {
        const names = pin.jobs.map((j) => j.nameZh).join('、');
        const status = state.kind === 'done' ? '已完成' : state.kind === 'partial' ? `完成 ${state.doneCount}/${state.total}` : state.kind === 'locked' ? '年齡未到' : '可參加';
        return (
          <button
            key={pin.key}
            type="button"
            data-pin={pin.key}
            onClick={() => onSelect(pin.key)}
            className={pinClasses(state, floor, selectedKey === pin.key, compact)}
            style={{ left: pct(pin.x), top: pct(pin.y) }}
            aria-label={`${pin.mapNo ?? ''} 號 ${names}，${status}${state.pending ? '，待確認' : ''}`}
          >
            {pin.mapNo ?? '?'}
            {state.pending && (
              <span className={`pointer-events-none absolute rounded-full border-2 border-dashed border-amber-500 ${compact ? '-inset-1' : '-inset-1.5'}`} />
            )}
            {!compact && state.kind === 'done' && (
              <span className="absolute -right-1.5 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#1d8a4a] text-[10px] text-white">✓</span>
            )}
            {!compact && state.kind === 'partial' && (
              <span className="absolute -right-2.5 -bottom-1.5 rounded-full bg-[#1d8a4a] px-1 text-[9px] leading-4 text-white">
                {state.doneCount}/{state.total}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

const SERVICE_ICON: Record<string, string> = {
  廁所: 'WC',
  ATM: 'ATM',
  醫療室: '+',
  AED: 'AED',
};

export function serviceIcon(f: Facility): string {
  for (const [k, v] of Object.entries(SERVICE_ICON)) if (f.nameZh.includes(k)) return v;
  return '•';
}

/** 字母設施（A–X）與服務設施（廁所、ATM…）；中央廣場等景點已畫在底圖上 */
export function FacilityLayer({
  facilities,
  showService,
  compact = false,
  selectedId,
  onSelect,
}: {
  facilities: Facility[];
  showService: boolean;
  compact?: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {facilities.map((f) => {
        const service = f.letter === null && f.facilityType === '服務設施';
        if (!f.letter && !service) return null;
        if (service && !showService) return null;
        const sel = selectedId === f.id ? ' z-20 scale-125 ring-2 ring-ink/40' : ' z-[5]';
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onSelect(f.id)}
            className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center font-bold shadow-sm transition-transform${sel} ${
              service
                ? `${compact ? 'h-3.5 min-w-3.5 text-[6px]' : 'h-5 min-w-5 text-[9px]'} rounded-md bg-sky-600 px-0.5 text-white`
                : `${compact ? 'h-4 w-4 text-[8px]' : 'h-6 w-6 text-[11px]'} rounded-md bg-white text-ink/75 ring-1 ring-ink/25`
            }`}
            style={{ left: pct(f.x), top: pct(f.y) }}
            aria-label={`${f.letter ? `${f.letter} ` : ''}${f.nameZh}`}
          >
            {f.letter ?? serviceIcon(f)}
          </button>
        );
      })}
    </>
  );
}
