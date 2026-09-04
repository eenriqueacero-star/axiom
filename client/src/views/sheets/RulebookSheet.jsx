import Icon from '../../ui/Icon';

const bar = (v, cap) => Math.min(100, (v / cap) * 100);

export function RulebookSheet({ diag }) {
  if (!diag?.ready) {
    return <p className="text-sm text-faint">Add or sync your holdings and the rulebook check fills in.</p>;
  }
  const sleeve = diag.sleeve || {};
  const core = Math.round((sleeve.corePct ?? 0) * 100);
  const target = Math.round((sleeve.targetCore ?? 0.5) * 100);
  const flags = diag.flags || [];

  return (
    <div className="space-y-5">
      <div>
        <h2 id="sheet-rulebook-title" className="mono text-xs tracking-[0.14em] text-text">THE RULEBOOK</h2>
        <p className="mt-1 text-[11px] text-muted">Where the book sits against every cap and target — pure math, no council judgement.</p>
      </div>

      <div className="space-y-3">
        <div>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted">Core sleeve</span>
            <span className="mono text-text">{core}% <span className="text-faint">/ target {target}%</span></span>
          </div>
          <div className="mt-1.5 h-[3px] rounded-sm bg-line-2 relative overflow-hidden">
            <i className="absolute inset-y-0 left-0 bg-muted" style={{ width: `${core}%` }} />
            <i className="absolute inset-y-0 w-px bg-lit/60" style={{ left: `${target}%` }} />
          </div>
        </div>

        {diag.sectors?.slice(0, 5).map((s) => {
          const p = Math.round(s.pct * 100);
          const over = s.pct > 0.35;
          return (
            <div key={s.name}>
              <div className="flex justify-between text-[11px]">
                <span className="text-muted">{s.name}</span>
                <span className={`mono ${over ? 'text-crit' : 'text-text'}`}>{p}%</span>
              </div>
              <div className="mt-1.5 h-[3px] rounded-sm bg-line-2 relative overflow-hidden">
                <i className={`absolute inset-y-0 left-0 ${over ? 'bg-crit' : 'bg-muted'}`} style={{ width: `${bar(s.pct, 0.35)}%` }} />
                <i className="absolute inset-y-0 w-px bg-lit/40" style={{ left: '100%' }} />
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <div className="label mb-2">{flags.length ? `${flags.length} breach${flags.length > 1 ? 'es' : ''}` : 'No breaches'}</div>
        <ul className="space-y-2">
          {flags.map((f, i) => (
            <li key={i} className="grid grid-cols-[13px_1fr] gap-2 text-[12px] leading-snug text-muted">
              <Icon name="warn" size={12} className="text-crit mt-0.5" />
              <span>{f.msg}</span>
            </li>
          ))}
          {!flags.length && <li className="text-[12px] text-muted">The book is inside every cap and on target.</li>}
        </ul>
      </div>
    </div>
  );
}
