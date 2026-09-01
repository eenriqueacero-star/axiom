import { verdictStyle } from './stance';

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
      {analysis.headline && (
        <p className="text-[15px] font-semibold text-neutral-100 mt-2">{analysis.headline}</p>
      )}
      {analysis.rationale && (
        <p className="text-sm text-neutral-300 mt-1 leading-relaxed">{analysis.rationale}</p>
      )}
      {(analysis.computed?.broken || analysis.computed?.downtrend || analysis.computed?.entryClear === false || analysis.computed?.concentrationBlock) && (
        <div className="flex flex-wrap gap-2 mt-3">
          {analysis.computed.broken && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-red-500/15 text-red-400">THESIS BROKEN</span>
          )}
          {analysis.computed.downtrend && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-red-500/15 text-red-400">CONFIRMED DOWNTREND</span>
          )}
          {analysis.computed.entryClear === false && !analysis.computed.broken && !analysis.computed.downtrend && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-400">ENTRY NOT CLEAR</span>
          )}
          {analysis.computed.concentrationBlock && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-400">ALREADY AT CAP</span>
          )}
        </div>
      )}
      {analysis.holdings && (
        <p className="text-xs text-haze mt-2">
          You hold {(analysis.holdings.positionPct * 100).toFixed(1)}% in {analysis.ticker}
          {' · '}{analysis.holdings.sector} sector {(analysis.holdings.sectorPct * 100).toFixed(0)}%
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
