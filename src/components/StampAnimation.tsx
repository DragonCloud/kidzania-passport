import { useEffect, useState, type ReactNode } from 'react';
import { playStampSound, vibrate } from '../lib/sound';
import { Stamp } from './Stamp';

/**
 * 蓋章動畫：印章從上方落下 → 落地瞬間畫面輕震、播放短音 → 顯示完成訊息與後續按鈕。
 * 使用者設定「減少動態效果」時直接顯示結果。
 */
export function StampAnimation({
  name,
  at,
  index,
  tilt,
  sound,
  message,
  actions,
}: {
  name: string;
  at: number;
  index: number;
  tilt: number;
  sound: boolean;
  message: ReactNode;
  actions: ReactNode;
}) {
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = window.setTimeout(
      () => {
        setLanded(true);
        if (sound) playStampSound();
        vibrate(35);
      },
      reduce ? 0 : 520,
    );
    return () => window.clearTimeout(t);
  }, [sound]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-paper/97 px-6" role="dialog" aria-modal="true" aria-label="蓋章完成">
      <div className={landed ? 'stamp-shake' : ''}>
        <div className="relative flex h-64 w-64 items-center justify-center rounded-[2rem] bg-white shadow-xl ring-1 ring-ink/5">
          <div className="stamp-drop" style={{ ['--tilt' as string]: `${tilt}deg` }}>
            <Stamp name={name} at={at} index={index} size={200} />
          </div>
          {landed && <span className="stamp-ring pointer-events-none absolute inset-0 rounded-[2rem]" />}
        </div>
      </div>
      <div className={`mt-8 text-center transition-all duration-500 ${landed ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}>
        {message}
        <div className="mt-6 flex w-full max-w-xs flex-col gap-2.5">{actions}</div>
      </div>
    </div>
  );
}
