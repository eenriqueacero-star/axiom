import { useEffect, useState } from 'react';
import { getScorecard, getBacktest, getQuantStatus } from '../api';

const AGENTS = { quality: 'SAGE', trend: 'REX', catalyst: 'NOVA', sector: 'ATLAS', bear: 'VEGA', sizing: 'ZEN' };
const VERDICTS = ['ADD', 'HOLD', 'TRIM', 'EXIT'];

const perf = (n) => (n == null ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1)}%`);
const rate = (n) => (n == null ? '—' : `${(n * 100).toFixed(0)}%`);
const cls = (n) => (n == null ? 'text-haze' : n >= 0 ? 'text-emerald-400' : 'text-[#f0685f]');

/* ---- strategy vs. the index ---- */

function StrategyBacktest() {
  const [bt, setBt] = useState(null);
  const [state, setState] = useState('loading'); // loading | off | error | ok

  useEffect(() => {
    getQuantStatus().then((s) => {
      if (!s.configured) { setState('off'); return; }
      getBacktest()
        .then((d) => { setBt(d); setState('ok'); })
        .catch(() => setState('error'));
    }).catch(() => setState('off'));
  }, []);

  if (state === 'off') return null;

  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-widest text-haze mb-2">Strategy vs. the index</h2>
      <div className="card p-4">
        {state === 'loading' && <p className="text-xs text-haze animate-pulse">Running the backtest…</p>}
        {state === 'error' && <p className="text-xs text-haze">Backtest service unavailable right now.</p>}
        {state === 'ok' && bt && (
          <>
            <p className="text-sm text-neutral-200 leading-relaxed">{bt.verdict}</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[11px] font-mono tabular-nums">
                <thead className="text-haze">
                  <tr className="border-b hairline">
                    <th className="text-left py-1.5 pr-3 font-normal">strategy</th>
                    <th className="text-right px-2 py-1.5 font-normal">CAGR</th>
                    <th className="text-right px-2 py-1.5 font-normal">vs QQQ</th>
                    <th className="text-right px-2 py-1.5 font-normal">max DD</th>
                    <th className="text-right px-2 py-1.5 font-normal">Sharpe</th>
                  </tr>
                </thead>
                <tbody>
                  {bt.rows.map((r) => (
                    <tr key={r.strategy} className="border-b hairline last:border-0">
                      <td className="py-1.5 pr-3 text-neutral-300">{r.strategy}</td>
                      <td className="px-2 py-1.5 text-right text-neutral-200">{perf(r.cagr)}</td>
                      <td className={`px-2 py-1.5 text-right ${cls(r.vs_qqq_cagr)}`}>{perf(r.vs_qqq_cagr)}</td>
                      <td className="px-2 py-1.5 text-right text-[#f0685f]">{perf(r.max_drawdown)}</td>
                      <td className="px-2 py-1.5 text-right text-neutral-400">{r.sharpe}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10px] text-ink-600">
              {bt.start} → {bt.end} · {Math.round(bt.years)}y · rules only, before tax — the council's judgment is the overlay on top.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

/* ---- verdict accuracy ---- */

export default function Scorecard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => { getScorecard().then(setData).catch((e) => setErr(e.message)); }, []);

  if (err) return <p className="text-xs text-[#f0685f]">{err}</p>;

  return (
    <div className="space-y-6">
      <StrategyBacktest />

      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-haze mb-2">Verdict accuracy</h2>
        {!data ? (
          <p className="text-xs text-haze animate-pulse">Loading…</p>
        ) : data.total === 0 ? (
          <div className="card p-5 text-sm text-haze">
            No verdicts have aged 5 days yet. This fills in as your past analyses mature — every
            council run from now on is tracked against what the stock actually does, and feeds
            the agent weights + calibration notes.
          </div>
        ) : (
          <div className="space-y-5">
            <p className="text-xs text-haze">{data.total} verdicts scored against real price moves since the call.</p>

            <div className="card overflow-hidden">
              <table className="w-full text-xs">
                <thead className="text-haze">
                  <tr className="border-b hairline">
                    <th className="text-left px-4 py-2 font-normal">verdict</th>
                    <th className="text-right px-3 py-2 font-normal">n</th>
                    <th className="text-right px-3 py-2 font-normal">avg move</th>
                    <th className="text-right px-3 py-2 font-normal">% up</th>
                    <th className="text-right px-4 py-2 font-normal">right?</th>
                  </tr>
                </thead>
                <tbody>
                  {VERDICTS.map((v) => {
                    const b = data.byVerdict?.[v] || {};
                    return (
                      <tr key={v} className="border-b hairline last:border-0">
                        <td className="px-4 py-2 text-neutral-200 font-mono">{v}</td>
                        <td className="px-3 py-2 text-right text-neutral-400">{b.n ?? 0}</td>
                        <td className={`px-3 py-2 text-right ${cls(b.avgPerf)}`}>{perf(b.avgPerf)}</td>
                        <td className="px-3 py-2 text-right text-neutral-400">{rate(b.pctUp)}</td>
                        <td className="px-4 py-2 text-right text-neutral-400">{rate(b.hitRate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div>
              <h3 className="text-[11px] uppercase tracking-widest text-haze mb-2">By agent stance</h3>
              <div className="space-y-3">
                {Object.entries(data.byAgent || {}).map(([id, stances]) =>
                  Object.keys(stances).length === 0 ? null : (
                    <div key={id} className="card p-3">
                      <p className="font-mono text-xs text-neutral-300 mb-2">{AGENTS[id] || id}</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        {Object.entries(stances).map(([st, b]) => (
                          <div key={st}>
                            <p className="text-haze">{st} ({b.n})</p>
                            <p className={cls(b.avgPerf)}>{perf(b.avgPerf)} avg</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
