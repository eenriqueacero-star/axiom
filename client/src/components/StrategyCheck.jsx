import { useEffect, useState } from 'react';
import { getStrategyDiagnostics } from '../api';

const pct = (n) => `${Math.round((n || 0) * 100)}%`;
const sevColor = {
  high: 'text-red-400 border-red-500/30 bg-red-500/5',
  medium: 'text-amber-400 border-amber-500/30 bg-amber-500/5',
};

export default function StrategyCheck() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    getStrategyDiagnostics().then(setD).catch((e) => setErr(e.message));
  }, []);

  if (err || !d) return null;
  if (!d.ready) return null;

  const top = d.sectors.slice(0, 4);

  return (
    <div className="card p-4 space-y-3">
      <p className="text-[11px] uppercase tracking-widest text-haze">Strategy check</p>

      <div className="flex gap-6 text-xs">
        <div>
          <span className="text-haze">Core</span>{' '}
          <span className={d.sleeve.corePct < d.sleeve.targetCore - 0.15 ? 'text-amber-400' : 'text-neutral-200'}>
            {pct(d.sleeve.corePct)}
          </span>
          <span className="text-ink-600"> / target {pct(d.sleeve.targetCore)}</span>
        </div>
        <div>
          <span className="text-haze">Satellite</span>{' '}
          <span className="text-neutral-200">{pct(d.sleeve.satellitePct)}</span>
        </div>
      </div>

      <div className="space-y-1">
        {top.map((s) => (
          <div key={s.name} className="flex items-center gap-2 text-[11px]">
            <span className="w-36 text-haze truncate">{s.name}</span>
            <div className="flex-1 h-1.5 rounded bg-ink-800 overflow-hidden">
              <div
                className={s.pct > 0.35 ? 'h-full bg-red-400/70' : 'h-full bg-indigo-400/60'}
                style={{ width: `${Math.min(s.pct * 100, 100)}%` }}
              />
            </div>
            <span className="w-9 text-right text-neutral-300">{pct(s.pct)}</span>
          </div>
        ))}
      </div>

      {d.flags.length > 0 && (
        <ul className="space-y-1.5 pt-1">
          {d.flags.map((f, i) => (
            <li key={i} className={`text-[11px] rounded border px-2 py-1.5 ${sevColor[f.severity] || sevColor.medium}`}>
              {f.msg}
            </li>
          ))}
        </ul>
      )}
      {d.flags.length === 0 && (
        <p className="text-[11px] text-emerald-400/80">On plan — no rule breaches.</p>
      )}
    </div>
  );
}
