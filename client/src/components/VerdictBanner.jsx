import { verdictStyle } from './stance';

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
      {analysis.nextEarnings && (
        <p className="text-xs text-haze mt-3">Next earnings: {analysis.nextEarnings}</p>
      )}
    </div>
  );
}
