import { stanceStyle } from './stance';

const MARK = {
  true: { s: '✓', c: 'text-emerald-400' },
  false: { s: '✗', c: 'text-red-400' },
  null: { s: '–', c: 'text-ink-600' },
};

export default function AgentCard({ agent, result, loading }) {
  const s = result ? stanceStyle(result.stance) : null;
  const checkKeys = agent.checks ? Object.keys(agent.checks) : [];

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-base" style={{ filter: 'saturate(1.1)' }}>{agent.emoji}</span>
          <span className="font-mono text-xs tracking-wider" style={{ color: agent.color }}>
            {agent.name}
          </span>
        </div>
        {loading ? (
          <span className="h-4 w-14 rounded bg-ink-800 animate-pulse" />
        ) : s ? (
          <span
            className="text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded"
            style={{ color: s.fg, background: s.bg }}
          >
            {s.label}
          </span>
        ) : null}
      </div>

      <p className="text-[11px] uppercase tracking-wide text-haze mb-2">{agent.role}</p>

      {loading ? (
        <div className="space-y-2">
          <div className="h-3 rounded bg-ink-800 animate-pulse" />
          <div className="h-3 w-4/5 rounded bg-ink-800 animate-pulse" />
        </div>
      ) : result ? (
        <>
          {result.headline && (
            <p className="text-sm text-neutral-200 mb-2">{result.headline}</p>
          )}
          <ul className="space-y-1 mb-2">
            {checkKeys.map((k) => {
              const v = result.checks?.[k];
              // VEGA's checks are inverted: true = a concern, false = all clear.
              const shown = agent.id === 'bear' && typeof v === 'boolean' ? !v : v;
              const m = MARK[String(shown)] || MARK.null;
              return (
                <li key={k} className="text-xs flex gap-1.5">
                  <span className={`${m.c} w-3`}>{m.s}</span>
                  <span className="text-neutral-400">{agent.checks[k]}</span>
                </li>
              );
            })}
          </ul>
          {result.note && (
            <p className="text-[11px] text-haze italic">{result.note}</p>
          )}
        </>
      ) : (
        <p className="text-xs text-ink-600">Waiting…</p>
      )}
    </div>
  );
}
