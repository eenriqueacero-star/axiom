import { useMemo, useState } from 'react';
import { getLatestAnalysis } from '../../api';
import Icon from '../../ui/Icon';

const V = {
  ADD:  { c: 'var(--good)', bg: 'rgba(75,173,131,0.13)' },
  HOLD: { c: 'var(--muted)', bg: 'rgba(255,255,255,0.04)' },
  TRIM: { c: 'var(--warn)', bg: 'rgba(214,154,62,0.13)' },
  EXIT: { c: 'var(--crit)', bg: 'rgba(224,87,78,0.13)' },
};
const money = (n) => `$${Math.round(n).toLocaleString()}`;

function DecisionDetail({ ticker }) {
  const [a, setA] = useState(undefined);
  useMemo(() => {
    getLatestAnalysis(ticker).then((r) => setA(r?.found ? r.analysis : null)).catch(() => setA(null));
  }, [ticker]);

  if (a === undefined) return <p className="py-2 text-[11px] text-faint">Loading the council's read…</p>;
  if (a === null) return <p className="py-2 text-[11px] text-faint">No council run on {ticker} yet.</p>;

  const c = a.computed || {};
  const econ = a.holdings?.econ;
  const flags = [
    c.broken && 'THESIS BROKEN', c.downtrendExit && 'DOWNTREND',
    c.concentrationTrim && 'OVER CAP', (c.atCap && !c.concentrationTrim) && 'AT CAP',
    c.entryClear === false && 'ENTRY NOT CLEAR',
  ].filter(Boolean);

  return (
    <div className="space-y-2.5 py-2">
      {a.headline && <p className="text-[12px] text-text leading-snug">{a.headline}</p>}
      {(a.impact || a.rationale) && <p className="text-[11.5px] text-muted leading-relaxed">{a.impact || a.rationale}</p>}
      {econ?.shares != null && (
        <p className="text-[11px] text-muted">
          {econ.shares} sh at ${Number(econ.avgCost || 0).toFixed(2)} avg
          {econ.value != null && ` — ${money(econ.value)}`}
          {econ.unrealPct != null && `, ${econ.unrealPct >= 0 ? 'up' : 'down'} ${Math.abs(econ.unrealPct * 100).toFixed(0)}%`}
        </p>
      )}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {flags.map((f) => <span key={f} className="mono text-[8px] px-1.5 py-0.5 rounded" style={{ color: 'var(--crit)', background: 'rgba(224,87,78,0.12)' }}>{f}</span>)}
        </div>
      )}
      {Array.isArray(a.agents) && (
        <ul className="pt-1 space-y-0.5">
          {a.agents.map((ag) => (
            <li key={ag.id || ag.name} className="text-[10px] text-faint leading-snug">
              <span className="text-muted">{ag.name}</span>{ag.stance ? ` — ${ag.stance}` : ''}{ag.note ? `: ${ag.note}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function HoldingsSheet({ pf, diag, stances, onAnalyze }) {
  const [open, setOpen] = useState(null);
  const rows = useMemo(() => {
    const out = [];
    for (const acct of pf?.accounts || []) {
      for (const p of acct.positions || []) {
        if (!p.ticker || (p.shares || 0) <= 0) continue;
        out.push({ ...p, account: acct.label });
      }
    }
    return out.sort((x, y) => (y.value || 0) - (x.value || 0));
  }, [pf]);

  const total = pf?.totals?.value || diag?.total || 1;
  const st = stances?.stances || {};

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <h2 id="sheet-holdings-title" className="mono text-xs tracking-[0.14em] text-text">THE BOOK</h2>
        <span className="mono text-[10px] text-faint">{rows.length} names</span>
      </div>
      {diag?.sleeve && (
        <p className="text-[11px] text-muted pb-2">
          Core {Math.round(diag.sleeve.corePct * 100)}% / Satellite {Math.round(diag.sleeve.satellitePct * 100)}% —
          target {Math.round((diag.sleeve.targetCore || 0.5) * 100)} / {Math.round((1 - (diag.sleeve.targetCore || 0.5)) * 100)}.
        </p>
      )}

      <ul className="divide-y divide-line">
        {rows.map((p) => {
          const s = st[p.ticker];
          const v = s && V[s.verdict];
          const w = (p.value || 0) / total;
          const isOpen = open === p.ticker;
          return (
            <li key={p.ticker + p.account}>
              <button onClick={() => setOpen(isOpen ? null : p.ticker)}
                className="grid w-full grid-cols-[52px_1fr_auto_auto] items-center gap-2.5 py-2.5 text-left">
                <span className="mono text-[12px] font-medium text-text">{p.ticker}</span>
                <span className="h-[3px] rounded-sm bg-line-2 relative overflow-hidden">
                  <i className="absolute inset-y-0 left-0 bg-muted" style={{ width: `${Math.min(100, w / 0.4 * 100)}%` }} />
                </span>
                <span className="mono text-[11px] text-muted tabular-nums">{money(p.value || 0)}</span>
                {v ? (
                  <span className="mono text-[8px] px-1.5 py-0.5 rounded" style={{ color: v.c, background: v.bg }}>{s.verdict}</span>
                ) : <span className="mono text-[8px] text-faint">—</span>}
              </button>
              {isOpen && <DecisionDetail ticker={p.ticker} />}
              {isOpen && (
                <button onClick={() => onAnalyze?.(p.ticker)} className="pb-2 mono text-[10px] text-rex">
                  run the council →
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <p className="pt-3 text-[11px] text-faint leading-relaxed">
        Editing positions, importing, and account management move here in the next pass.
      </p>
    </div>
  );
}
