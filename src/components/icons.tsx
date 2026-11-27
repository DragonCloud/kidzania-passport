import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

function Base({ children, ...p }: P) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      {children}
    </svg>
  );
}

export const IconHome = (p: P) => <Base {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></Base>;
export const IconMap = (p: P) => <Base {...p}><path d="m9 4-6 2.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z" /><path d="M9 4v13.5M15 6.5V20" /></Base>;
export const IconPassport = (p: P) => <Base {...p}><rect x="5" y="2.5" width="14" height="19" rx="2" /><circle cx="12" cy="10" r="3.5" /><path d="M9 17h6" /></Base>;
export const IconSettings = (p: P) => <Base {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Base>;
export const IconSearch = (p: P) => <Base {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Base>;
export const IconFilter = (p: P) => <Base {...p}><path d="M4 6h16M7 12h10M10 18h4" /></Base>;
export const IconBack = (p: P) => <Base {...p}><path d="M15 18l-6-6 6-6" /></Base>;
export const IconClose = (p: P) => <Base {...p}><path d="M18 6 6 18M6 6l12 12" /></Base>;
export const IconExternal = (p: P) => <Base {...p}><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Base>;
export const IconClock = (p: P) => <Base {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Base>;
export const IconLock = (p: P) => <Base {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Base>;
export const IconStamp = (p: P) => <Base {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5.5" strokeDasharray="2.5 2" /><path d="m9.5 12 1.8 1.8 3.4-3.6" /></Base>;
export const IconPin = (p: P) => <Base {...p}><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></Base>;
export const IconAlert = (p: P) => <Base {...p}><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17.5v.01" /></Base>;
