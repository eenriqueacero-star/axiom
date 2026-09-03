import { useEffect, useMemo, useState } from 'react';
import { getCongress } from '../api';

const money = (n) => (n == null ? '—' : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}k`);
const ago = (d) => {
  if (!d) return '';
  const days = Math.round((Date.now() - new Date(d).getTime()) / 864e5);
  return days <= 0 ? 'today' : days === 1 ? '1d ago' : `${days}d ago`;
};

const CHIP = 'text-[11px] px-2 py-1 rounded border transition-colors';

export default function Congress({ onAnalyze }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ heldOnly: false, type: '', chamber: '', days: 90, minAmount: '' });
  const [q, setQ] = useState('');

  useEffect(() => {
    setData(null);
    getCongress({
      days: f.days, type: f.type || null, chamber: f.chamber || null,
      minAmount: f.minAmount || null, heldOnly: f.heldOnly ? 1 : null,
    }).then(setData).catch((e) => setErr(e.message));
  }, [f]);

  const rows = useMemo(() => {
    if (!data?.trades) return [];
    const term = q.trim().toLowerCase();
    return term
      ? data.trades.filter((t) => t.member.toLowerCase().includes(term) || t.ticker.toLowerCase().includes(term))
      : data.trades;
  }, [data, q]);

  if (err) return <p className="text-xs text-[#f0685f]">{err}</p>;
  if (data && !data.configured) {
    return (
      <div className="card p-5 text-sm text-haze space-y-2">
        <p className="text-neutral-200">Congressional trading isn’t connected yet.</p>
        <p>
          Every free no-signup source is dead in 2026. Add one API key to the backend and this fills in:
        </p>
        <ul className="text-xs space-y-1 pl-4 list-disc">
          <li><span className="text-neutral-300">FMP_API_KEY</span> — Financial Modeling Prep, free tier, House + Senate</li>
          <li><span className="text-neutral-300">QUIVER_API_KEY</span> — Quiver Quantitative, $25/mo, cleanest &amp; most current</li>
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-sm text-neutral-200">Congress</h1>
        <p className="text-[11px] text-haze">
          Disclosed trades by members of Congress{data?.provider ? ` · via ${data.provider}` : ''}. Rows in your book are highlighted.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="member or ticker"
          className="h-8 px-2 rounded bg-ink-900 border border-ink-800 text-xs w-44"
        />
        <button onClick={() => setF((s) => ({ ...s, heldOnly: !s.heldOnly }))}
          className={`${CHIP} ${f.heldOnly ? 'border-indigo-500/50 text-indigo-300 bg-indigo-500/10' : 'border-ink-800 text-haze'}`}>
          my holdings only
        </button>
        {['buy', 'sell'].map((t) => (
          <button key={t} onClick={() => setF((s) => ({ ...s, type: s.type === t ? '' : t }))}
            className={`${CHIP} ${f.type === t ? 'border-current bg-current/10' : 'border-ink-800 text-haze'}`}
            style={f.type === t ? { color: t === 'buy' ? '#34d399' : '#f0685f' } : undefined}>
            {t}s
          </button>
        ))}
        {['House', 'Senate'].map((c) => (
          <button key={c} onClick={() => setF((s) => ({ ...s, chamber: s.chamber === c ? '' : c }))}
            className={`${CHIP} ${f.chamber === c ? 'border-indigo-500/50 text-indigo-300 bg-indigo-500/10' : 'border-ink-800 text-haze'}`}>
            {c}
          </button>
        ))}
        <select value={f.minAmount} onChange={(e) => setF((s) => ({ ...s, minAmount: e.target.value }))}
          className="h-8 px-1 rounded bg-ink-900 border border-ink-800 text-xs text-haze">
          <option value="">any size</option>
          <option value="15001">$15k+</option>
          <option value="50001">$50k+</option>
          <option value="100001">$100k+</option>
          <option value="250001">$250k+</option>
        </select>
        <select value={f.days} onChange={(e) => setF((s) => ({ ...s, days: Number(e.target.value) }))}
          className="h-8 px-1 rounded bg-ink-900 border border-ink-800 text-xs text-haze">
          <option value={30}>30d</option>
          <option value={90}>90d</option>
          <option value={180}>6mo</option>
          <option value={365}>1yr</option>
        </select>
      </div>

      {!data ? (
        <p className="text-xs text-haze animate-pulse">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-haze">No disclosed trades match.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-haze">
              <tr className="border-b hairline">
                <th className="text-left px-3 py-2 font-normal">member</th>
                <th className="text-left px-2 py-2 font-normal">ticker</th>
                <th className="text-left px-2 py-2 font-normal">action</th>
                <th className="text-right px-2 py-2 font-normal">size</th>
                <th className="text-right px-3 py-2 font-normal">traded</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => (
                <tr key={t.id || i} className={`border-b hairline last:border-0 ${t.isHeld ? 'bg-indigo-500/[0.06]' : ''}`}>
                  <td className="px-3 py-2 text-neutral-300">
                    {t.member}<span className="text-ink-600"> · {t.chamber}{t.party ? ` ${t.party[0]}` : ''}</span>
                  </td>
                  <td className="px-2 py-2">
                    <button onClick={() => onAnalyze?.(t.ticker)}
                      className={`font-mono ${t.isHeld ? 'text-indigo-300' : 'text-neutral-200'} hover:text-indigo-300`}>
                      {t.ticker}
                    </button>
                  </td>
                  <td className="px-2 py-2 font-mono" style={{ color: t.type === 'buy' ? '#34d399' : t.type === 'sell' ? '#f0685f' : '#8b8b96' }}>
                    {t.type}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-neutral-400">
                    {money(t.amountLow)}–{money(t.amountHigh)}
                  </td>
                  <td className="px-3 py-2 text-right text-haze">{t.txDate} <span className="text-ink-600">· {ago(t.txDate)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
