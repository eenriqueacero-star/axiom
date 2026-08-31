import { useEffect, useState } from 'react';
import { getScorecard } from '../api';

const AGENTS = {
  technical: 'REX', catalyst: 'NOVA', risk: 'SAGE',
  macro: 'ATLAS', bear: 'VEGA', sizer: 'ZEN',
};

const perf = (n) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`);
const rate = (n) => (n == null ? '—' : `${(n * 100).toFixed(0)}%`);
const cls = (n) => (n == null ? 'text-haze' : n >= 0 ? 'text-emerald-400' : 'text-red-400');

export default function Scorecard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    getScorecard().then(setData).catch((e) => setErr(e.message));
  }, []);

  if (err) return <p className="text-xs text-red-400">{err}</p>;
  if (!data) return <p className="text-xs text-haze animate-pulse">Loading…</p>;

  if (data.total === 0) {
    return (
      <div className="card p-5 text-sm text-haze">
        No verdicts have aged 7+ days yet. The scorecard fills in as your past
        analyses mature — check back in a week or two. Every council run from now
        on gets tracked against what the stock actually does.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-haze">
        {data.total} verdicts scored against actual price moves since the call.
      </p>

      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-haze mb-2">By verdict</h2>
        <div className="card overflow-hidden">
          <table className="w-full text-xs">
            <thead className="text-haze">
              <tr className="border-b hairline">
                <th className="text-left px-4 py-2 font-normal">Verdict</th>
                <th className="text-right px-3 py-2 font-normal">n</th>
                <th className="text-right px-3 py-2 font-normal">avg move</th>
                <th className="text-right px-3 py-2 font-normal">% up</th>
                <th className="text-right px-4 py-2 font-normal">right?</th>
              </tr>
            </thead>
            <tbody>
              {['BUY', 'WATCH', 'SKIP'].map((v) => {
                const b = data.byVerdict[v] || {};
                return (
                  <tr key={v} className="border-b hairline last:border-0">
                    <td className="px-4 py-2 text-neutral-200">{v}</td>
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
      </section>

      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-haze mb-2">By agent stance</h2>
        <div className="space-y-3">
          {Object.entries(data.byAgent).map(([id, stances]) =>
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
      </section>
    </div>
  );
}
