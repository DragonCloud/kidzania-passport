import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BottomSheet } from '../components/BottomSheet';
import { EconomyTag } from '../components/EconomyTag';
import { JobStatusBadges } from '../components/JobBadges';
import { FloorSvg, VIEW_W, viewH } from '../components/map/FloorSvg';
import { OfficialMapImage } from '../components/map/OfficialMapImage';
import { FacilityLayer, PinLayer, type PinView } from '../components/map/PinLayer';
import { useChild } from '../hooks/useChild';
import { useCompletions } from '../hooks/useCompletions';
import { useSetting } from '../hooks/useSetting';
import { canJoinNow, eligibility } from '../lib/age';
import { formatAgeReq } from '../lib/format';
import { FACILITIES, facilitiesForFloor, pinsForFloor, pinState } from '../lib/jobs';
import { setSetting } from '../lib/settings';
import type { Floor } from '../types/models';

/** 縮放級距：全景（寬度剛好）→ 填滿高度（預設）→ 再放大 1.5 倍 */
function zoomLevels(fitHeight: number): number[] {
  const fit = Math.max(1.2, fitHeight);
  return [1, fit, fit * 1.5];
}
/** 一般開啟：寬度剛好（整層都看得到）；從職業頁指定圖釘開啟：填滿高度並置中到圖釘 */
const DEFAULT_ZOOM_INDEX = 0;
const PIN_ZOOM_INDEX = 1;
/** 低於這個縮放倍率時改用小圖釘 */
const COMPACT_BELOW = 1.6;

export default function MapPage() {
  const [params, setParams] = useSearchParams();
  const floor: Floor = params.get('floor') === '2' ? 2 : 1;
  const pinKey = params.get('pin');
  const facId = params.get('fac');
  const { years } = useChild();
  const { stats } = useCompletions();
  const showService = useSetting('showServiceIcons');
  const official = useSetting(floor === 1 ? 'officialMap1F' : 'officialMap2F');
  const [useOfficial, setUseOfficial] = useState(true);
  const [zoomIndex, setZoomIndex] = useState(() => (params.get('pin') ? PIN_ZOOM_INDEX : DEFAULT_ZOOM_INDEX));
  const scroller = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  const boxWidth = box.w;
  const levels = zoomLevels(box.w ? box.h / (box.w * (viewH(floor) / VIEW_W)) : 2);
  const zoom = levels[zoomIndex]!;
  const compact = zoom < COMPACT_BELOW;

  const pins: PinView[] = useMemo(
    () =>
      pinsForFloor(floor).map((pin) => ({
        pin,
        state: pinState(
          pin,
          (j) => years === null || canJoinNow(eligibility(j, years)),
          (j) => stats.has(j.id),
        ),
      })),
    [floor, years, stats],
  );
  const facilities = useMemo(() => facilitiesForFloor(floor), [floor]);

  const setQuery = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  // 把指定的點（0–1）捲到可視範圍中央
  const centerOn = useCallback(
    (x: number, y: number, smooth = true) => {
      const el = scroller.current;
      if (!el) return;
      const inner = el.firstElementChild as HTMLElement | null;
      if (!inner) return;
      el.scrollTo({
        left: x * inner.offsetWidth - el.clientWidth / 2,
        top: y * inner.offsetHeight - el.clientHeight / 2,
        behavior: smooth ? 'smooth' : 'auto',
      });
    },
    [],
  );

  // 換樓層或縮放後：有指定圖釘就置中到圖釘，否則置中整層
  const lastCentered = useRef('');
  useEffect(() => {
    if (!boxWidth) return;
    const sig = `${floor}-${zoomIndex}-${boxWidth}`;
    if (lastCentered.current === sig) return;
    lastCentered.current = sig;
    const p = pins.find((v) => v.pin.key === pinKey)?.pin;
    requestAnimationFrame(() => (p ? centerOn(p.x, p.y, false) : centerOn(0.55, 0.5, false)));
  }, [boxWidth, floor, zoomIndex, pins, pinKey, centerOn]);

  const selectedPin = pins.find((v) => v.pin.key === pinKey) ?? null;
  const selectedFac = facId ? (FACILITIES.find((f) => f.id === facId) ?? null) : null;

  const openCount = pins.filter((p) => p.state.kind === 'open' || p.state.kind === 'partial').length;
  const doneCount = pins.filter((p) => p.state.kind === 'done').length;

  return (
    <main className="mx-auto flex h-dvh max-w-md flex-col pb-[calc(64px+env(safe-area-inset-bottom))]">
      <header className="safe-top px-4 pt-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-black">地圖</h1>
          <div className="flex rounded-2xl bg-ink/[0.06] p-1" role="tablist" aria-label="樓層">
            {([1, 2] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={floor === f}
                onClick={() => {
                  lastCentered.current = '';
                  setQuery({ floor: String(f), pin: null, fac: null });
                }}
                className={`w-14 rounded-xl py-1.5 text-sm font-black ${floor === f ? (f === 1 ? 'bg-brand text-white' : 'bg-teal-600 text-white') : 'text-ink/55'}`}
              >
                {f}F
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-xs text-ink/55">
          {floor}F：可去 {openCount} 館・已完成 {doneCount} 館・點圖釘看職業
        </p>
      </header>

      <div className="relative mt-2 min-h-0 flex-1">
        <div ref={scroller} className="h-full overflow-auto overscroll-contain bg-[#f6efe2]" style={{ touchAction: 'pan-x pan-y' }}>
          <div className="relative" style={{ width: boxWidth ? boxWidth * zoom : '100%' }}>
            <FloorSvg floor={floor} />
            {official && useOfficial && <OfficialMapImage floor={floor} blobId={official} />}
            <FacilityLayer
              facilities={facilities}
              showService={showService}
              compact={compact}
              selectedId={facId}
              onSelect={(id) => setQuery({ fac: id, pin: null })}
            />
            <PinLayer pins={pins} floor={floor} compact={compact} selectedKey={pinKey} onSelect={(k) => setQuery({ pin: k, fac: null })} />
          </div>
          {zoomIndex === 0 && <p className="px-4 py-3 text-center text-xs text-ink/45">點圖釘看職業；按右下「＋」放大後可上下左右滑動</p>}
        </div>

        <div className="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-ink/10">
          <button
            type="button"
            disabled={zoomIndex === levels.length - 1}
            onClick={() => setZoomIndex((i) => Math.min(levels.length - 1, i + 1))}
            className="h-11 w-11 text-xl font-bold disabled:opacity-30"
            aria-label="放大"
          >
            ＋
          </button>
          <span className="h-px bg-ink/10" />
          <button
            type="button"
            disabled={zoomIndex === 0}
            onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
            className="h-11 w-11 text-xl font-bold disabled:opacity-30"
            aria-label="縮小"
          >
            －
          </button>
        </div>

        {official && (
          <button
            type="button"
            onClick={() => setUseOfficial((v) => !v)}
            className="absolute bottom-3 left-3 rounded-full bg-white px-3 py-2 text-xs font-bold shadow-md ring-1 ring-ink/10"
          >
            {useOfficial ? '改看示意圖' : '看官方圖（本機）'}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-2 text-[11px] text-ink/65">
        <Legend className={floor === 2 ? 'bg-teal-600' : 'bg-brand'}>可參加</Legend>
        <Legend className="-rotate-12 border-2 border-[#1d8a4a] bg-white">已完成</Legend>
        <Legend className="bg-stone-300">年齡未到</Legend>
        <Legend className="border-2 border-dashed border-amber-500 bg-transparent">待確認</Legend>
        <label className="ml-auto flex items-center gap-1">
          <input
            type="checkbox"
            checked={showService}
            onChange={(e) => void setSetting('showServiceIcons', e.target.checked)}
            className="h-4 w-4 accent-sky-600"
          />
          廁所／ATM
        </label>
      </div>

      <BottomSheet
        open={!!selectedPin}
        title={selectedPin ? `${selectedPin.pin.mapNo ?? '?'} 號・${selectedPin.pin.jobs[0]!.venueZh}` : ''}
        onClose={() => setQuery({ pin: null })}
      >
        {selectedPin && (
          <ul className="mt-2 space-y-2">
            {selectedPin.pin.jobs.map((j) => {
              const e = eligibility(j, years);
              return (
                <li key={j.id}>
                  <Link to={`/job/${j.id}`} className="block rounded-2xl bg-white p-3 ring-1 ring-ink/5 active:bg-ink/[0.03]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">{j.nameZh}</span>
                      <span className="text-sm font-bold text-brand">詳情 ›</span>
                    </div>
                    <p className="mt-0.5 text-xs text-ink/55">
                      {j.sponsor ?? ''}
                      {j.sponsor ? '・' : ''}
                      {formatAgeReq(j)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <EconomyTag job={j} />
                      <JobStatusBadges job={j} eligibility={e} stats={stats.get(j.id)} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </BottomSheet>

      <BottomSheet
        open={!!selectedFac}
        title={selectedFac ? `${selectedFac.letter ? `${selectedFac.letter}・` : ''}${selectedFac.nameZh}` : ''}
        onClose={() => setQuery({ fac: null })}
      >
        {selectedFac && (
          <dl className="mt-2 space-y-2 rounded-2xl bg-white p-4 text-sm ring-1 ring-ink/5">
            <div className="flex gap-3">
              <dt className="w-14 shrink-0 text-ink/55">類型</dt>
              <dd>{selectedFac.facilityType}</dd>
            </div>
            {selectedFac.sponsor && (
              <div className="flex gap-3">
                <dt className="w-14 shrink-0 text-ink/55">品牌</dt>
                <dd>{selectedFac.sponsor}</dd>
              </div>
            )}
            {selectedFac.notes && (
              <div className="flex gap-3">
                <dt className="w-14 shrink-0 text-ink/55">備註</dt>
                <dd>{selectedFac.notes}</dd>
              </div>
            )}
            <p className="pt-1 text-xs text-ink/45">設施不是職業體驗，不列入蓋章。</p>
          </dl>
        )}
      </BottomSheet>
    </main>
  );
}

function Legend({ className, children }: { className: string; children: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-3.5 w-3.5 rounded-full ${className}`} />
      {children}
    </span>
  );
}
