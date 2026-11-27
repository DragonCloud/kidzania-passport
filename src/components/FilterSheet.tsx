import { useEffect, type ReactNode } from 'react';
import { CATEGORIES, type EconomyKind } from '../lib/jobs';
import type { JobFilters } from '../lib/filters';
import { IconClose } from './icons';

const ECON_OPTIONS: { value: EconomyKind; label: string }[] = [
  { value: 'earn', label: '賺 kidZos' },
  { value: 'spend', label: '付 kidZos' },
  { value: 'twd', label: '自費新臺幣' },
  { value: 'unknown', label: '收支未公布' },
];

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition ${
        on ? 'bg-ink text-white ring-ink' : 'bg-white text-ink/80 ring-ink/15'
      }`}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-sm font-bold text-ink/70">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

export function FilterSheet({
  open,
  filters,
  resultCount,
  onChange,
  onReset,
  onClose,
}: {
  open: boolean;
  filters: JobFilters;
  resultCount: number;
  onChange: (patch: Partial<JobFilters>) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  const toggleEcon = (v: EconomyKind) =>
    onChange({ econ: filters.econ.includes(v) ? filters.econ.filter((x) => x !== v) : [...filters.econ, v] });

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="篩選">
      <button type="button" className="absolute inset-0 bg-ink/40" aria-label="關閉篩選" onClick={onClose} />
      <div className="safe-bottom relative max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-paper px-5 pt-4 pb-4 shadow-2xl">
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-ink/15" />
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">篩選</h2>
          <button type="button" onClick={onClose} className="-mr-2 p-2 text-xl text-ink/60" aria-label="關閉">
            <IconClose />
          </button>
        </div>

        <Section title="樓層">
          <Chip on={filters.floor === null} onClick={() => onChange({ floor: null })}>全部</Chip>
          <Chip on={filters.floor === 1} onClick={() => onChange({ floor: 1 })}>1F</Chip>
          <Chip on={filters.floor === 2} onClick={() => onChange({ floor: 2 })}>2F</Chip>
        </Section>

        <Section title="收支（可複選）">
          {ECON_OPTIONS.map((o) => (
            <Chip key={o.value} on={filters.econ.includes(o.value)} onClick={() => toggleEcon(o.value)}>
              {o.label}
            </Chip>
          ))}
        </Section>

        <Section title="分類">
          <Chip on={filters.cat === null} onClick={() => onChange({ cat: null })}>全部</Chip>
          {CATEGORIES.map((c) => (
            <Chip key={c} on={filters.cat === c} onClick={() => onChange({ cat: c })}>
              {c}
            </Chip>
          ))}
        </Section>

        <Section title="完成狀態">
          <Chip on={filters.status === null} onClick={() => onChange({ status: null })}>全部</Chip>
          <Chip on={filters.status === 'todo'} onClick={() => onChange({ status: 'todo' })}>還沒玩</Chip>
          <Chip on={filters.status === 'done'} onClick={() => onChange({ status: 'done' })}>已完成</Chip>
        </Section>

        <Section title="資料">
          <Chip on={filters.pendingOnly} onClick={() => onChange({ pendingOnly: !filters.pendingOnly })}>只看待確認</Chip>
        </Section>

        <div className="sticky bottom-0 mt-6 flex gap-3 bg-paper pt-2">
          <button type="button" onClick={onReset} className="flex-1 rounded-2xl bg-white py-3 font-bold ring-1 ring-ink/15">
            清除
          </button>
          <button type="button" onClick={onClose} className="flex-[2] rounded-2xl bg-brand py-3 font-bold text-white">
            顯示 {resultCount} 項
          </button>
        </div>
      </div>
    </div>
  );
}
