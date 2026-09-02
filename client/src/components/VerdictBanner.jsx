import { verdictStyle, tierStyle, stripMd } from './stance';

const fmtPct = (n) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(0)}%`);

export default function VerdictBanner({ analysis }) {
  const v = verdictStyle(analysis.verdict);
  const chg = analysis.changePct;

  return (
    <div
      className="rounded-xl p-5 border"
      style={{ background: v.bg, borderColor: v.ring }}
    >
      <div className="flex items-baseline justify-between mb-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-lg tracking-wider text-neutral-100">
            {analysis.ticker}
          </span>
          {analysis.price != null && (
            <span className="text-sm text-neutral-400">
              ${Number(analysis.price).toFixed(2)}
              {chg != null && (
                <span className={chg >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {' '}{chg >= 0 ? '+' : ''}{Number(chg).toFixed(2)}%
                </span>
              )}
            </span>
          )}
        </div>
        <span
          className="text-sm font-bold tracking-wide"
          style={{ color: v.fg }}
        >
          {analysis.verdict} · {analysis.conviction}/10
        </span>
      </div>
      {tierStyle(analysis.tier) && (
        <p className="text-[11px] font-mono uppercase tracking-wider mt-0.5" style={{ color: tierStyle(analysis.tier).fg }}>
          {tierStyle(analysis.tier).label} conviction
          {analysis.tierReasons?.length ? <span className="text-haze normal-case tracking-normal"> — {analysis.tierReasons.join(' · ')}</span> : null}
        </p>
      )}
      {analysis.headline && (
        <p className="text-[15px] font-semibold text-neutral-100 mt-2">{stripMd(analysis.headline)}</p>
      )}
      {analysis.rationale && (
        <p className="text-sm text-neutral-300 mt-1 leading-relaxed">{stripMd(analysis.rationale)}</p>
      )}
      {(() => {
        const c = analysis.computed || {};
        const chips = [];
        if (c.thinData) chips.push(['NOT ENOUGH DATA — UNRATED', '#7c8db5']);
        if (c.broken) chips.push(['THESIS BROKEN', '#f0685f']);
        if (c.downtrendExit) chips.push(['DOWNTREND + WEAK FUNDAMENTALS', '#f0685f']);
        else if (c.downtrend) chips.push(['IN A DOWNTREND', '#e0a33a']);
        if (c.concentrationTrim) chips.push([`OVERSIZED — ${c.overCapX ? c.overCapX + '× CAP' : 'TRIM TO SIZE'}`, '#e0a33a']);
        if (c.atCap && !c.concentrationTrim) chips.push(['AT CAP — WOULD ADD', '#7c8db5']);
        if (c.entryClear === false && !c.broken && !c.downtrend) chips.push(['ENTRY NOT CLEAR', '#e0a33a']);
        if (c.structuralBear && !c.broken) chips.push(['STRUCTURAL BEAR CASE', '#e0a33a']);
        if (!chips.length) return null;
        return (
          <div className="flex flex-wrap gap-2 mt-3">
            {chips.map(([label, col]) => (
              <span key={label} className="text-[10px] font-semibold px-2 py-0.5 rounded"
                style={{ color: col, background: `${col}26` }}>{label}</span>
            ))}
          </div>
        );
      })()}
      {analysis.holdings && (
        <p className="text-xs text-haze mt-2">
          {analysis.holdings.econ?.avgCost != null ? (
            <>
              The firm holds {analysis.holdings.econ.shares} sh @ ${analysis.holdings.econ.avgCost.toFixed(2)} avg
              {' · '}
              <span className={analysis.holdings.econ.unreal >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {analysis.holdings.econ.unreal >= 0 ? '+' : '−'}{Math.abs(analysis.holdings.econ.unrealPct * 100).toFixed(0)}%
              </span>
              {' · '}
            </>
          ) : (
            <>Position {(analysis.holdings.positionPct * 100).toFixed(1)}% · </>
          )}
          {analysis.holdings.sector} sector {(analysis.holdings.sectorPct * 100).toFixed(0)}%
          {analysis.holdings.breachIfAdd ? ' (at cap)' : ''}
        </p>
      )}
      {analysis.facts?.available && (
        <p className="text-xs text-haze mt-3">
          {analysis.facts.trend?.toUpperCase()} · {fmtPct(analysis.facts.pctFromHigh52w)} from 52wk high · 6mo {fmtPct(analysis.facts.ret6m)}
        </p>
      )}
      {analysis.nextEarnings && (
        <p className="text-xs text-haze mt-1">Next earnings: {analysis.nextEarnings}</p>
      )}
    </div>
  );
}
