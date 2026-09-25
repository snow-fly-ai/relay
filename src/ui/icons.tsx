import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const SendIcon = (p: P) => (
  <svg {...base} {...p}><path d="M12 19V5M5 12l7-7 7 7" /></svg>
);
export const StopIcon = (p: P) => (
  <svg {...base} {...p}><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" /></svg>
);
export const CheckIcon = (p: P) => (
  <svg {...base} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const ClockIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const AlertIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" /></svg>
);
export const MoreIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="5.5" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="18.5" r="1.3" fill="currentColor" /></svg>
);
export const DownIcon = (p: P) => (
  <svg {...base} {...p}><path d="M12 5v14M5 12l7 7 7-7" /></svg>
);
export const MailIcon = (p: P) => (
  <svg {...base} {...p}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M4 7l8 6 8-6" /></svg>
);
export const RefreshIcon = (p: P) => (
  <svg {...base} {...p}><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" /></svg>
);
export const XIcon = (p: P) => (
  <svg {...base} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>
);

/** Brand mark: speech bubble with a spark, on the accent gradient. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden>
      <defs>
        <linearGradient id="relay-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF6A4D" />
          <stop offset="1" stopColor="#FFB054" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="260" fill="url(#relay-logo)" />
      <path d="M332 286h360c50 0 90 40 90 90v214c0 50-40 90-90 90H486l-118 92c-14 11-34 1-34-17v-75h-2c-50 0-90-40-90-90V376c0-50 40-90 90-90z" fill="none" stroke="#fff" strokeWidth="60" strokeLinejoin="round" />
      <path d="M512 366c10 58 34 82 92 92-58 10-82 34-92 92-10-58-34-82-92-92 58-10 82-34 92-92z" fill="#fff" />
    </svg>
  );
}
