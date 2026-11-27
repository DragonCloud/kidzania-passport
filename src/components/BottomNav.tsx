import { NavLink } from 'react-router-dom';
import { IconHome, IconMap, IconPassport, IconSettings } from './icons';

const TABS = [
  { to: '/', label: '總覽', Icon: IconHome },
  { to: '/map', label: '地圖', Icon: IconMap },
  { to: '/passport', label: '護照', Icon: IconPassport },
  { to: '/settings', label: '設定', Icon: IconSettings },
] as const;

export function BottomNav() {
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-white/95 backdrop-blur" aria-label="主選單">
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {TABS.map(({ to, label, Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] font-medium ${isActive ? 'text-brand' : 'text-ink/55'}`
              }
            >
              <Icon className="h-6 w-6" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
