import { frameSize } from '../../config/defaults';
import type { Floor } from '../../types/models';

/**
 * 自繪 1F／2F 示意底圖（非官方圖、非實際比例）。
 * 只畫抽象的樓板、街道、廣場與區塊提示，圖釘位置由 jobs/facilities 的 x,y 決定。
 * viewBox 寬固定 1000，高依官方取景框比例換算，讓 x,y（0–1）可直接對應。
 */
export const VIEW_W = 1000;
export function viewH(floor: Floor): number {
  const { width, height } = frameSize(floor);
  return Math.round((VIEW_W * height) / width);
}

interface Street {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  tone: 'kids' | 'food' | 'plaza';
}
interface Label {
  x: number;
  y: number;
  text: string;
  arrow?: 'up' | 'down';
}

/** 座標皆為 0–1 比例 */
const LAYOUT: Record<Floor, { streets: Street[]; zones: Zone[]; plaza?: { x: number; y: number; r: number }; labels: Label[] }> = {
  1: {
    streets: [
      { x1: 0.03, y1: 0.37, x2: 0.84, y2: 0.37 },
      { x1: 0.2, y1: 0.63, x2: 0.84, y2: 0.63 },
      { x1: 0.29, y1: 0.14, x2: 0.29, y2: 0.94 },
      { x1: 0.62, y1: 0.14, x2: 0.62, y2: 0.94 },
      { x1: 0.03, y1: 0.14, x2: 0.97, y2: 0.14 },
    ],
    zones: [
      { x: 0.83, y: 0.46, w: 0.165, h: 0.4, label: '幼兒區', tone: 'kids' },
      { x: 0.2, y: 0.52, w: 0.24, h: 0.11, label: '', tone: 'food' },
    ],
    plaza: { x: 0.42, y: 0.42, r: 0.055 },
    labels: [
      { x: 0.66, y: 0.065, text: '入口', arrow: 'down' },
      { x: 0.43, y: 0.065, text: '出口', arrow: 'up' },
    ],
  },
  2: {
    streets: [
      { x1: 0.2, y1: 0.5, x2: 0.9, y2: 0.5 },
      { x1: 0.41, y1: 0.18, x2: 0.41, y2: 0.92 },
      { x1: 0.65, y1: 0.18, x2: 0.65, y2: 0.92 },
    ],
    zones: [],
    labels: [],
  },
};

const TONE = {
  kids: { fill: '#fde7f0', stroke: '#f4b6cf', text: '#b04b7a' },
  food: { fill: '#fff1d6', stroke: '#f3d39a', text: '#a26a00' },
  plaza: { fill: '#e6f4ea', stroke: '#b5dcc0', text: '#2f7a4a' },
};

export function FloorSvg({ floor }: { floor: Floor }) {
  const H = viewH(floor);
  const L = LAYOUT[floor];
  const X = (v: number) => v * VIEW_W;
  const Y = (v: number) => v * H;
  const accent = floor === 1 ? '#e8572a' : '#0d9488';

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${H}`} className="block h-auto w-full select-none" role="img" aria-label={`${floor} 樓示意圖`}>
      <defs>
        <pattern id={`dots-${floor}`} width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.2" fill="#e7dcc8" />
        </pattern>
      </defs>
      <rect x="0" y="0" width={VIEW_W} height={H} fill="#f6efe2" />
      <rect x="10" y="10" width={VIEW_W - 20} height={H - 20} rx="28" fill="#fffaf1" stroke="#e5d7bf" strokeWidth="3" />
      <rect x="10" y="10" width={VIEW_W - 20} height={H - 20} rx="28" fill={`url(#dots-${floor})`} />

      {L.zones.map((z, i) => {
        const t = TONE[z.tone];
        return (
          <g key={i}>
            <rect x={X(z.x)} y={Y(z.y)} width={X(z.w)} height={Y(z.h)} rx="18" fill={t.fill} stroke={t.stroke} strokeWidth="2" strokeDasharray="6 5" />
            {z.label && (
              <text x={X(z.x + z.w / 2)} y={Y(z.y + z.h) - 10} textAnchor="middle" fontSize="15" fontWeight="700" fill={t.text}>
                {z.label}
              </text>
            )}
          </g>
        );
      })}

      {L.streets.map((s, i) => (
        <g key={i}>
          <line x1={X(s.x1)} y1={Y(s.y1)} x2={X(s.x2)} y2={Y(s.y2)} stroke="#ecdfc9" strokeWidth="26" strokeLinecap="round" />
          <line x1={X(s.x1)} y1={Y(s.y1)} x2={X(s.x2)} y2={Y(s.y2)} stroke="#fffaf1" strokeWidth="2" strokeDasharray="10 12" strokeLinecap="round" />
        </g>
      ))}

      {L.plaza && (
        <g>
          <circle cx={X(L.plaza.x)} cy={Y(L.plaza.y)} r={X(L.plaza.r)} fill={TONE.plaza.fill} stroke={TONE.plaza.stroke} strokeWidth="3" />
          <circle cx={X(L.plaza.x)} cy={Y(L.plaza.y)} r={X(L.plaza.r) * 0.45} fill="none" stroke={TONE.plaza.stroke} strokeWidth="2" />
          <text x={X(L.plaza.x)} y={Y(L.plaza.y) + X(L.plaza.r) + 20} textAnchor="middle" fontSize="15" fontWeight="700" fill={TONE.plaza.text}>
            中央廣場
          </text>
        </g>
      )}

      {L.labels.map((l, i) => (
        <g key={i} transform={`translate(${X(l.x)} ${Y(l.y)})`}>
          <rect x="-30" y="-15" width="60" height="30" rx="15" fill={accent} />
          <text y="5.5" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff">
            {l.arrow === 'down' ? '↓ ' : '↑ '}
            {l.text}
          </text>
        </g>
      ))}

      <text x={VIEW_W - 28} y={H - 26} textAnchor="end" fontSize="13" fill="#b3a58e">
        {floor}F 示意圖・非實際比例
      </text>
      <text x="30" y={H - 22} fontSize="46" fontWeight="900" fill={accent} opacity="0.13">
        {floor}F
      </text>
    </svg>
  );
}
