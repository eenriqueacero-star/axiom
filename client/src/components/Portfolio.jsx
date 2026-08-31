import { useEffect, useState } from 'react';
import { getPortfolio, setHolding, addTicker, removeTicker, importPositions } from '../api';
import BrokerLink from './BrokerLink';

const money = (n) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
// ratios (gain/loss) → *100; Finnhub day-change % is already in percent units
const pct = (n) => (n == null ? '' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`);
const pctRaw = (n) => (n == null ? '' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);
const cls = (n) => (n == null ? 'text-haze' : n >= 0 ? 'text-emerald-400' : 'text-red-400');

export default function Portfolio({ onAnalyze }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null); // `${acct}:${ticker}`
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(null); // accountId
  const [newTicker, setNewTicker] = useState('');
  const [importing, setImporting] = useState(null); // accountId
  const [importText, setImportText] = useState('');
  const [importBusy, setImportBusy] = useState(false);

  const load = () => getPortfolio().then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const saveShares = async (acct, ticker) => {
    setEditing(null);
    try {
      setData(await setHolding(acct, ticker, { shares: Number(draft) || 0 }));
    } catch (e) { setErr(e.message); }
  };

  const doAdd = async (acct) => {
    const t = newTicker.toUpperCase().trim();
    setAdding(null); setNewTicker('');
    if (!/^[A-Z.\-]{1,10}$/.test(t)) return;
    try { setData(await addTicker(acct, t)); } catch (e) { setErr(e.message); }
  };

  const doRemove = async (acct, ticker) => {
    try { setData(await removeTicker(acct, ticker)); } catch (e) { setErr(e.message); }
  };

  const doImport = async (acct) => {
    setImportBusy(true);
    setErr('');
    try {
      const { portfolio } = await importPositions(acct, importText);
      setData(portfolio);
      setImporting(null);
      setImportText('');
    } catch (e) { setErr(e.message); }
    finally { setImportBusy(false); }
  };

  if (err) return <p className="text-xs text-red-400">{err}</p>;
  if (!data) return <p className="text-xs text-haze animate-pulse">Loading portfolio…</p>;

  const { totals } = data;
  const hasValue = totals.value > 0;

  return (
    <div className="space-y-5">
      <div className="card p-4">
        <p className="text-[11px] uppercase tracking-widest text-haze">Total</p>
        <p className="text-2xl font-mono text-neutral-100 mt-1">{money(totals.value)}</p>
        <div className="flex gap-4 mt-1 text-xs">
          <span className={cls(totals.dayChange)}>{money(totals.dayChange)} today</span>
          {totals.gain != null && (
            <span className={cls(totals.gain)}>{money(totals.gain)} ({pct(totals.gainPct)}) all-time</span>
          )}
        </div>
        {!hasValue && (
          <p className="text-xs text-haze mt-2">
            Add your share counts below to see real values.
          </p>
        )}
      </div>

      <BrokerLink onSynced={setData} />

      {data.accounts.map((acct) => (
        <section key={acct.id}>
          <div className="flex items-baseline justify-between mb-2">
            <div>
              <h2 className="text-sm text-neutral-200">{acct.label}</h2>
              <p className="text-[11px] text-haze">{acct.sub}{acct.dcaNote ? ` · ${acct.dcaNote}` : ''}</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setImporting(acct.id); setImportText(''); }}
                className="text-[11px] text-indigo-400 hover:text-indigo-300"
              >
                paste positions
              </button>
              <span className="font-mono text-sm text-neutral-300">{money(acct.value)}</span>
            </div>
          </div>

          {importing === acct.id && (
            <div className="card p-3 mb-2 space-y-2">
              <p className="text-[11px] text-haze">
                Paste from your broker — any format works (<span className="font-mono">NVDA 12</span>,
                CSV, or the copied positions table). Shares first, cost basis second if you have it.
              </p>
              <textarea
                autoFocus
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={6}
                placeholder={'NVDA 12 180.50\nAMD 8 175'}
                className="w-full bg-ink-900 border border-ink-800 rounded p-2 text-xs font-mono"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => doImport(acct.id)}
                  disabled={importBusy || !importText.trim()}
                  className="h-8 px-4 rounded bg-indigo-500 text-white text-xs disabled:opacity-50"
                >
                  {importBusy ? 'Importing…' : 'Import'}
                </button>
                <button
                  onClick={() => setImporting(null)}
                  className="h-8 px-3 rounded bg-ink-800 text-xs text-haze"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <ul className="divide-y divide-ink-800 card overflow-hidden">
            {acct.positions.map((p) => {
              const key = `${acct.id}:${p.ticker}`;
              return (
                <li key={p.ticker} className="px-4 py-3 flex items-center gap-3">
                  <button
                    onClick={() => onAnalyze(p.ticker)}
                    className="font-mono text-sm text-neutral-200 hover:text-indigo-400 w-16 text-left"
                  >
                    {p.ticker}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-neutral-400">
                      {p.price != null ? `$${p.price.toFixed(2)}` : '—'}
                      {p.changePct != null && (
                        <span className={`ml-1 ${cls(p.changePct)}`}>{pctRaw(p.changePct)}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-haze flex items-center gap-1">
                      {editing === key ? (
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => saveShares(acct.id, p.ticker)}
                          onKeyDown={(e) => e.key === 'Enter' && saveShares(acct.id, p.ticker)}
                          className="w-16 bg-ink-900 border border-ink-700 rounded px-1 text-neutral-200"
                          inputMode="decimal"
                        />
                      ) : (
                        <button
                          onClick={() => { setEditing(key); setDraft(String(p.shares || '')); }}
                          className="hover:text-neutral-300"
                        >
                          {p.shares ? `${p.shares} sh` : 'set shares'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs font-mono text-neutral-300">{p.value ? money(p.value) : ''}</div>
                    {p.gainPct != null && (
                      <div className={`text-[11px] ${cls(p.gainPct)}`}>{pct(p.gainPct)}</div>
                    )}
                  </div>

                  <button
                    onClick={() => doRemove(acct.id, p.ticker)}
                    className="text-ink-600 hover:text-red-400 text-xs"
                    title="Remove"
                  >
                    ✕
                  </button>
                </li>
              );
            })}

            <li className="px-4 py-2">
              {adding === acct.id ? (
                <input
                  autoFocus
                  value={newTicker}
                  onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
                  onBlur={() => doAdd(acct.id)}
                  onKeyDown={(e) => e.key === 'Enter' && doAdd(acct.id)}
                  placeholder="Ticker"
                  className="w-24 bg-ink-900 border border-ink-700 rounded px-2 py-1 text-xs font-mono"
                />
              ) : (
                <button
                  onClick={() => setAdding(acct.id)}
                  className="text-xs text-haze hover:text-neutral-300"
                >
                  + add holding
                </button>
              )}
            </li>
          </ul>
        </section>
      ))}
    </div>
  );
}
