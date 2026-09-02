import { useEffect, useState } from 'react';
import { getStrategyDiagnostics } from '../api';

const pct = (n) => `${Math.round((n || 0) * 100)}%`;

/**
 * Allocation panel — the rulebook's read on the shape of the book: sleeve mix,
 * sector concentration, and any cap breaches. Lives in the Portfolio right rail.
 */
export default function StrategyCheck() {
  const [d, setD] = useState(null);
  const [openFlags, setOpenFlags] = useState(false);

  useEffect(() => {
    getStrategyDiagnostics().then(setD).catch(() => setD(false));
  }, []);

  if (!d || !d.ready) return null;

  const sectors = d.sectors.slice(0, 5);
  const flags = d.flags || [];
  const worst = flags.reduce((a, f) => (f.severity === 'high' ? 'high' : a), flags.length ? 'medium' : null);
  const coreOff = Math.abs(d.sleeve.corePct - d.sleeve.targetCore) > 0.15;

  const status = worst === 'high'
    ? { label: 'Over-concentrated', color: '#e0a33a' }
    : worst === 'medium' || coreOff
      ? { label: 'Drifting off plan', color: '#e0a33a' }
      : { label: 'On plan', color: '#34d399' };

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] uppercase tracking-[0.2em] text-haze">Allocation</p>
        <span className="text-[11px] font-medium" style={{ color: status.color }}>{status.label}</span>
      </div>

      {/* sleeve mix — one bar, core vs satellite, against the 50/50 target */}
      <div>
        <div className="flex items-baseline justify-between text-[11px] mb-1.5">
          <span className="text-neutral-300">Core / Satellite</span>
          <span className="font-mono text-haze">
            {pct(d.sleeve.corePct)} / {pct(d.sleeve.satellitePct)}
            <span className="text-ink-600"> · target {pct(d.sleeve.targetCore)}/{pct(1 - d.sleeve.targetCore)}</span>
          </span>
        </div>
        <div className="relative h-2 rounded-full bg-ink-800 overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-indigo-400/70" style={{ width: `${d.sleeve.corePct * 100}%` }} />
          {/* target marker */}
          <div className="absolute inset-y-0 w-px bg-neutral-100/40" style={{ left: `${d.sleeve.targetCore * 100}%` }} />
        </div>
      </div>

      {/* sector concentration */}
      <div className="space-y-1.5">
        {sectors.map((s) => {
          const over = s.pct > 0.35;
          return (
            <div key={s.name} className="flex items-center gap-2 text-[11px]">
              <span className="w-32 truncate text-neutral-400">{s.name}</span>
              <div className="flex-1 h-1.5 rounded-full bg-ink-800 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(s.pct * 100, 100)}%`, background: over ? '#e0a33a' : '#6366f1aa' }}
                />
              </div>
              <span className={`w-9 text-right font-mono ${over ? 'text-amber-400' : 'text-neutral-400'}`}>{pct(s.pct)}</span>
            </div>
          );
        })}
        <p className="text-[10px] text-ink-600 pt-0.5">Vertical line = 35% sector cap · marker on the bar = target mix</p>
      </div>

      {/* cap breaches — collapsed to a count, one plain line each when open */}
      {flags.length > 0 ? (
        <div className="pt-1 border-t hairline">
          <button
            onClick={() => setOpenFlags((v) => !v)}
            className="text-[11px] text-neutral-300 hover:text-neutral-100 flex items-center gap-1.5"
          >
            <span style={{ color: status.color }}>{flags.length} rule {flags.length === 1 ? 'breach' : 'breaches'}</span>
            <span className="text-ink-600">{openFlags ? '−' : '+'}</span>
          </button>
          {openFlags && (
            <ul className="mt-2 space-y-1.5">
              {flags.map((f, i) => (
                <li key={i} className="text-[11px] text-haze leading-snug flex gap-2">
                  <span style={{ color: f.severity === 'high' ? '#e0a33a' : '#7c8db5' }}>—</span>
                  <span>{f.msg}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-[11px] pt-1 border-t hairline" style={{ color: '#34d399' }}>No cap breaches.</p>
      )}
    </div>
  );
}
