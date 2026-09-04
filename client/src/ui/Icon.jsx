/**
 * Axiom's icon set — one thin-line SVG per concept, no emoji anywhere.
 * <Icon name="filing" size={16} />  — inherits currentColor.
 */
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };

const PATHS = {
  /* nav */
  book:   <><rect x="3" y="4" width="14" height="12" rx="1.5" {...P} /><path d="M3 8h14M7 4v12" {...P} /></>,
  floor:  <><circle cx="10" cy="10" r="2.4" {...P} /><circle cx="10" cy="10" r="7" {...P} strokeDasharray="2.2 3" /></>,
  run:    <path d="M4 10h4l1.6-4.5 2.8 9L16 10h0" {...P} />,
  alerts: <><path d="M10 3c-2.8 0-4 2-4 5v3l-1.6 2.4h11.2L14 11V8c0-3-1.2-5-4-5Z" {...P} /><path d="M8.4 16a1.7 1.7 0 0 0 3.2 0" {...P} /></>,
  you:    <><circle cx="10" cy="7" r="3" {...P} /><path d="M4.5 16c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" {...P} /></>,

  /* notification kinds */
  news:     <><rect x="3" y="4.5" width="12" height="10" rx="1" {...P} /><path d="M3 7.5h12M6 10h6M6 12h4" {...P} /></>,
  filing:   <><path d="M6 3h5l4 4v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" {...P} /><path d="M11 3v4h4M7.5 11h5M7.5 13.5h3.5" {...P} /></>,
  insider:  <><circle cx="10" cy="6.5" r="2.6" {...P} /><path d="M5 16c0-2.6 2.2-4 5-4s5 1.4 5 4" {...P} /></>,
  congress: <><path d="M3.5 16h13M5 16V8M7.5 16V8M12.5 16V8M15 16V8M3 8h14L10 3 3 8Z" {...P} /></>,
  move:     <path d="M4 13l4-5 3 3 5-7M13 4h3v3" {...P} />,
  rating:   <path d="M10 3v14M5 7l5-4 5 4M5 13l5 4 5-4" {...P} />,
  scout:    <><circle cx="8.5" cy="8.5" r="4.5" {...P} /><path d="M12 12l4 4" {...P} /></>,
  desk:     <><rect x="3.5" y="5" width="13" height="10" rx="1" {...P} /><path d="M6 8.5h8M6 11h5" {...P} /></>,
  opportunity: <><path d="M10 3a4 4 0 0 0-2.5 7.1V13h5V10.1A4 4 0 0 0 10 3Z" {...P} /><path d="M8 16h4" {...P} /></>,
  macro:    <><rect x="3" y="5" width="14" height="11" rx="1" {...P} /><path d="M3 8.5h14M7 3v3M13 3v3" {...P} /></>,

  /* verdicts & checks */
  add:    <path d="M10 15V5M6 9l4-4 4 4" {...P} />,
  hold:   <path d="M5 10h10" {...P} />,
  trim:   <path d="M6 8l4 4 4-4" {...P} />,
  exit:   <path d="M10 5v10M6 11l4 4 4-4" {...P} />,
  check:  <path d="M4 10.5l3.5 3.5L16 6" {...P} />,
  cross:  <path d="M6 6l8 8M14 6l-8 8" {...P} />,

  /* agents — real ids are quality/trend/catalyst/bear/sector/sizing */
  quality:  <><path d="M4 15V5a1 1 0 0 1 1-1h4v11H4ZM11 4h4a1 1 0 0 1 1 1v10h-6V4Z" {...P} /></>,
  trend:    <path d="M3 14l4.5-5L11 12l6-8" {...P} />,
  catalyst: <path d="M10 3l1.8 4.8L17 10l-5.2 2.2L10 17l-1.8-4.8L3 10l5.2-2.2L10 3Z" {...P} />,
  bear:     <><path d="M10 3.5 16.5 15h-13L10 3.5Z" {...P} /><path d="M10 8.5v3" {...P} /></>,
  sector:   <><circle cx="10" cy="10" r="6.5" {...P} /><path d="M3.5 10h13M10 3.5c2.5 2.5 2.5 10.5 0 13M10 3.5c-2.5 2.5-2.5 10.5 0 13" {...P} /></>,
  sizing:   <><path d="M10 3v13M5 6h10M5 6c0 2.6 1.7 4 3 4M15 6c0 2.6-1.7 4-3 4M5.5 16h9" {...P} /></>,

  /* misc */
  chat:   <path d="M4 5h12v7H8l-3 2.5V12H4V5Z" {...P} />,
  close:  <path d="M5 5l10 10M15 5L5 15" {...P} />,
  back:   <path d="M12 4l-6 6 6 6" {...P} />,
  chevron:<path d="M7 4l6 6-6 6" {...P} />,
  up:     <path d="M10 15V5M5 10l5-5 5 5" {...P} />,
  warn:   <><path d="M10 3 18 16H2L10 3Z" {...P} /><path d="M10 8v3.5" {...P} /><circle cx="10" cy="14" r="0.6" fill="currentColor" /></>,
  plus:   <path d="M10 5v10M5 10h10" {...P} />,
  spark:  <path d="M10 3v3M10 14v3M3 10h3M14 10h3M5.2 5.2l2 2M12.8 12.8l2 2M14.8 5.2l-2 2M7.2 12.8l-2 2" {...P} />,
  sync:   <path d="M15 6a6 6 0 1 0 1.5 4M15 3v3h-3" {...P} />,
  coin:   <><ellipse cx="10" cy="6" rx="6" ry="2.6" {...P} /><path d="M4 6v8c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6V6" {...P} /><path d="M4 10c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6" {...P} /></>,
};

export default function Icon({ name, size = 16, className = '', style }) {
  const path = PATHS[name];
  if (!path) return null;
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  );
}

/** Keyed by the real agent id (quality/trend/…), not the display name.
 *  hex is for canvas (which can't read CSS vars); color is for the DOM. */
export const AGENT_META = {
  quality:  { name: 'SAGE',  color: 'var(--sage)',  hex: '#a874e8', remit: 'Business quality' },
  trend:    { name: 'REX',   color: 'var(--rex)',   hex: '#6d74ee', remit: 'Entry & trend' },
  catalyst: { name: 'NOVA',  color: 'var(--nova)',  hex: '#e6a13c', remit: 'Catalysts & news' },
  bear:     { name: 'VEGA',  color: 'var(--vega)',  hex: '#e05b52', remit: 'The bear case' },
  sector:   { name: 'ATLAS', color: 'var(--atlas)', hex: '#4b8fe0', remit: 'Sector health' },
  sizing:   { name: 'ZEN',   color: 'var(--zen)',   hex: '#43b981', remit: 'Sizing & the rulebook' },
};
export const AGENT_IDS = ['quality', 'trend', 'catalyst', 'bear', 'sector', 'sizing'];
