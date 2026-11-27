import { useId } from 'react';
import { stampDate } from '../lib/format';

/** 第 1 次紅、第 2 次藍、第 3 次綠…（再訪換色） */
export const STAMP_COLORS = ['#d23c26', '#2856c9', '#1d8a4a', '#8a3cc9', '#c27400', '#c2266f'] as const;

export function stampColor(visitIndex: number): string {
  return STAMP_COLORS[(Math.max(1, visitIndex) - 1) % STAMP_COLORS.length]!;
}

/** 依 id 產生固定的小角度，讓印章看起來是手蓋的 */
export function stampTilt(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 21) - 10) * 1.2;
}

/**
 * 圓戳：外圈職業名、中間日期、下方「第 N 次」。
 * 自繪 SVG，不使用任何官方圖樣。
 */
export function Stamp({
  name,
  at,
  index = 1,
  size = 120,
  tilt = 0,
  className = '',
}: {
  name: string;
  at: number;
  index?: number;
  size?: number;
  tilt?: number;
  className?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const color = stampColor(index);
  const fontSize = name.length > 6 ? 13 : name.length > 4 ? 15 : 17;
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      style={{ transform: `rotate(${tilt}deg)` }}
      role="img"
      aria-label={`${name} 印章 ${stampDate(at)}${index > 1 ? ` 第 ${index} 次` : ''}`}
    >
      <defs>
        <path id={`top-${uid}`} d="M 20 60 A 40 40 0 0 1 100 60" />
        <path id={`bot-${uid}`} d="M 24 64 A 36 36 0 0 0 96 64" />
        <filter id={`ink-${uid}`}>
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="3" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.9 1.2" result="mask" />
          <feComposite in="SourceGraphic" in2="mask" operator="in" />
        </filter>
      </defs>
      <g filter={`url(#ink-${uid})`} fill={color} stroke={color}>
        <circle cx="60" cy="60" r="56" fill="none" strokeWidth="4" />
        <circle cx="60" cy="60" r="49" fill="none" strokeWidth="1.5" />
        <text fontSize={fontSize} fontWeight="900" letterSpacing="1" stroke="none" textAnchor="middle">
          <textPath href={`#top-${uid}`} startOffset="50%">
            {name}
          </textPath>
        </text>
        <line x1="26" y1="50" x2="94" y2="50" strokeWidth="1.5" />
        <text x="60" y="68" fontSize="13" fontWeight="800" textAnchor="middle" stroke="none" fontFamily="ui-monospace, monospace">
          {stampDate(at)}
        </text>
        <line x1="26" y1="76" x2="94" y2="76" strokeWidth="1.5" />
        <text fontSize="11" fontWeight="800" stroke="none" textAnchor="middle">
          <textPath href={`#bot-${uid}`} startOffset="50%">
            {index > 1 ? `★ 第 ${index} 次 ★` : '★ 職業護照 ★'}
          </textPath>
        </text>
      </g>
    </svg>
  );
}

/** 尚未蓋章的空格 */
export function EmptyStamp({ label, locked = false, size = 96 }: { label: string; locked?: boolean; size?: number }) {
  return (
    <div
      className={`flex items-center justify-center rounded-full border-2 border-dashed p-2 text-center text-[11px] leading-tight font-bold ${
        locked ? 'border-stone-300 text-stone-400' : 'border-ink/20 text-ink/40'
      }`}
      style={{ width: size, height: size }}
    >
      {label}
    </div>
  );
}
