import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { IconBack } from './icons';

/** 推入頁的頂列：返回鍵（沒有上一頁時回總覽）＋標題 */
export function PageHeader({ title, right }: { title: string; right?: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const back = () => (location.key === 'default' ? navigate('/', { replace: true }) : navigate(-1));
  return (
    <header className="safe-top sticky top-0 z-30 bg-paper/95 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-md items-center gap-1 px-2">
        <button type="button" onClick={back} className="flex h-10 w-10 items-center justify-center rounded-full text-2xl active:bg-ink/5" aria-label="返回">
          <IconBack />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-base font-bold">{title}</h1>
        {right}
      </div>
    </header>
  );
}
