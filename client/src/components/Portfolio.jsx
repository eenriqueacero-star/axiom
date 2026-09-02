import { useEffect, useState } from 'react';
import {
  getPortfolio, setHolding, addTicker, removeTicker, importPositions, deleteAccount, renameAccount,
  getStances, getLatestAnalysis, getAgents,
} from '../api';
import BrokerLink from './BrokerLink';
import StrategyCheck from './StrategyCheck';
import { verdictStyle, stanceStyle, tierStyle, stripMd } from './stance';

const STANCE_STYLE = {
  ADD: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5',
  HOLD: 'text-neutral-300 border-ink-700 bg-ink-800/50',
  TRIM: 'text-amber-400 border-amber-500/30 bg-amber-500/5',
  EXIT: 'text-red-400 border-red-500/30 bg-red-500/5',
};

/** The council's latest verdict on a held name. Tap → expand the reasoning. */
function StanceBadge({ s, onClick, open }) {
  if (!s || !s.analyzed || !s.verdict) return null;
  const title = [
    s.headline,
    s.stale ? '(stale — council hasn’t re-run recently)' : '',
  ].filter(Boolean).join(' ');
  return (
    <button
      onClick={onClick}
      title={title || s.verdict}
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide
        ${STANCE_STYLE[s.verdict] || STANCE_STYLE.HOLD} ${s.stale ? 'opacity-50' : ''}
        ${open ? 'ring-1 ring-current' : ''}`}
    >
      {s.verdict}{s.conviction != null ? ` ${s.conviction}` : ''}
    </button>
  );
}

/** Conviction tier — the belief, shown next to the action badge. */
function TierTag({ t }) {
  const st = tierStyle(t);
  if (!st) return null;
  return (
    <span
      title={`Conviction: ${st.hint}`}
      className="shrink-0 text-[9px] font-mono uppercase tracking-wider opacity-80"
      style={{ color: st.fg }}
    >
      {st.label}
    </span>
  );
}

const FLAGS = [
  ['broken', 'THESIS BROKEN', 'bg-red-500/15 text-red-400'],
  ['downtrend', 'CONFIRMED DOWNTREND', 'bg-red-500/15 text-red-400'],
  ['concentrationBlock', 'ALREADY AT CAP', 'bg-amber-500/15 text-amber-400'],
];

/**
 * Why the council landed where it did — the latest stored run, shown inline
 * under the holding. `a` is undefined while loading, null when never run.
 */
function DecisionDetail({ ticker, a, agents, onFull }) {
  if (a === undefined) {
    return <div className="px-4 pb-3 text-[11px] text-haze animate-pulse">Loading the council’s notes…</div>;
  }
  if (a === null) {
    return (
      <div className="px-4 pb-3 text-[11px] text-haze">
        The council hasn’t run on {ticker} yet.{' '}
        <button onClick={onFull} className="text-indigo-400 hover:text-indigo-300">Convene it →</button>
      </div>
    );
  }

  const v = verdictStyle(a.verdict);
  const c = a.computed || {};
  const entryNotClear = c.entryClear === false && !c.broken && !c.downtrend;

  return (
    <div className="px-4 pb-4 pt-1 space-y-3 border-t border-ink-800/60 bg-ink-900/30">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold tracking-wide" style={{ color: v.fg }}>
          {a.verdict} · {a.conviction}/10
          {tierStyle(a.tier) && (
            <span className="ml-2 font-mono text-[10px] tracking-wider" style={{ color: tierStyle(a.tier).fg }}>
              {tierStyle(a.tier).label} CONVICTION
            </span>
          )}
        </span>
        <button onClick={onFull} className="text-[11px] text-indigo-400 hover:text-indigo-300">
          full analysis →
        </button>
      </div>
      {a.tier && a.tierReasons?.length > 0 && (
        <p className="text-[10px] text-haze -mt-2">{a.tierReasons.join(' · ')}</p>
      )}

      {a.headline && <p className="text-sm text-neutral-100 font-medium">{stripMd(a.headline)}</p>}
      {a.rationale && <p className="text-xs text-neutral-300 leading-relaxed">{stripMd(a.rationale)}</p>}

      {(c.broken || c.downtrend || c.concentrationBlock || entryNotClear) && (
        <div className="flex flex-wrap gap-1.5">
          {FLAGS.filter(([k]) => c[k]).map(([k, label, cls]) => (
            <span key={k} className={`text-[10px] font-semibold px-2 py-0.5 rounded ${cls}`}>{label}</span>
          ))}
          {entryNotClear && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-400">ENTRY NOT CLEAR</span>
          )}
        </div>
      )}

      {agents.length > 0 && a.agents && (
        <ul className="space-y-1">
          {agents.map((ag) => {
            const r = a.agents[ag.id];
            if (!r) return null;
            const st = stanceStyle(r.stance);
            return (
              <li key={ag.id} className="text-[11px] flex gap-2">
                <span className="w-14 shrink-0 font-mono" style={{ color: ag.color }}>{ag.name}</span>
                <span className="w-16 shrink-0 font-semibold" style={{ color: st.fg }}>{st.label}</span>
                <span className="text-haze truncate">{stripMd(r.note || r.headline || '')}</span>
              </li>
            );
          })}
        </ul>
      )}

      {a.catalyst && (
        <p className="text-[11px] text-neutral-400">
          <span className="text-indigo-400">Catalyst:</span> {stripMd(a.catalyst)}
        </p>
      )}
      {a.ts && (
        <p className="text-[10px] text-ink-600">Council run {ago(a.ts)}</p>
      )}
    </div>
  );
}

const money = (n) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
// ratios (gain/loss) → *100; Finnhub day-change % is already in percent units
const pct = (n) => (n == null ? '' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`);
const pctRaw = (n) => (n == null ? '' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);
const cls = (n) => (n == null ? 'text-haze' : n >= 0 ? 'text-emerald-400' : 'text-red-400');

const ago = (ts) => {
  if (!ts) return '';
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export default function Portfolio({ onAnalyze }) {
  const [data, setData] = useState(null);
  const [stances, setStances] = useState({});
  const [agents, setAgents] = useState([]);
  const [expanded, setExpanded] = useState(null);   // ticker
  const [analyses, setAnalyses] = useState({});     // ticker -> analysis | null | undefined(loading)
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null); // `${acct}:${ticker}`
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(null); // accountId
  const [newTicker, setNewTicker] = useState('');
  const [importing, setImporting] = useState(null); // accountId
  const [importText, setImportText] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [renaming, setRenaming] = useState(null); // accountId
  const [nameDraft, setNameDraft] = useState('');
  const [confirmDel, setConfirmDel] = useState(null); // accountId awaiting confirm
  const [delBusy, setDelBusy] = useState(false);

  const load = () => getPortfolio().then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    getStances().then((r) => setStances(r.stances || {})).catch(() => {});
    getAgents().then(setAgents).catch(() => {});
  }, []);

  const toggleDetail = (ticker) => {
    setExpanded((cur) => (cur === ticker ? null : ticker));
    if (!(ticker in analyses) && expanded !== ticker) {
      setAnalyses((m) => ({ ...m, [ticker]: undefined }));
      getLatestAnalysis(ticker)
        .then((r) => setAnalyses((m) => ({ ...m, [ticker]: r.found ? r.analysis : null })))
        .catch(() => setAnalyses((m) => ({ ...m, [ticker]: null })));
    }
  };

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

  const doDeleteAccount = async (acctId) => {
    setDelBusy(true);
    setErr('');
    try {
      const next = await deleteAccount(acctId);
      setConfirmDel(null);
      setData(next);
    } catch (e) {
      setErr(e.message);
    } finally {
      setDelBusy(false);
    }
  };

  const saveName = async (acct) => {
    setRenaming(null);
    try { setData(await renameAccount(acct, nameDraft)); } catch (e) { setErr(e.message); }
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
            Link a broker or paste your positions to see real values.
          </p>
        )}
      </div>

      <BrokerLink onSynced={setData} />
      <StrategyCheck />

      {data.accounts.map((acct) => {
        const linked = acct.linked;
        return (
          <section key={acct.id}>
            <div className="flex items-baseline justify-between mb-2">
              <div>
                {renaming === acct.id ? (
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={() => saveName(acct.id)}
                    onKeyDown={(e) => e.key === 'Enter' && saveName(acct.id)}
                    placeholder="Account name"
                    className="w-40 bg-ink-900 border border-ink-700 rounded px-1 text-sm text-neutral-200"
                  />
                ) : (
                  <h2
                    className="text-sm text-neutral-200 hover:text-indigo-400 cursor-text"
                    onClick={() => { setRenaming(acct.id); setNameDraft(acct.label); }}
                    title="Rename"
                  >
                    {acct.label}
                  </h2>
                )}
                <p className="text-[11px] text-haze">
                  {acct.sub}{acct.dcaNote ? ` · ${acct.dcaNote}` : ''}
                  {linked && (
                    <span className="text-emerald-500/80"> · synced {ago(acct.syncedAt)}</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {!linked && (
                  <button
                    onClick={() => { setImporting(acct.id); setImportText(''); }}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300"
                  >
                    paste positions
                  </button>
                )}
                <span className="font-mono text-sm text-neutral-300">{money(acct.value)}</span>
              </div>
            </div>

            {importing === acct.id && !linked && (
              <div className="card p-3 mb-2 space-y-2">
                <p className="text-[11px] text-haze">
                  Paste from your broker — any format works (a symbol and share count per line,
                  CSV, or the copied positions table). Shares first, cost basis second if you have it.
                </p>
                <textarea
                  autoFocus
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={6}
                  placeholder={'One position per line'}
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
                const isOpen = expanded === p.ticker;
                return (
                  <li key={p.ticker}>
                   <div className="px-4 py-3 flex items-center gap-3">
                    <button
                      onClick={() => toggleDetail(p.ticker)}
                      className="font-mono text-sm text-neutral-200 hover:text-indigo-400 w-16 text-left"
                    >
                      {p.ticker}
                    </button>

                    <StanceBadge s={stances[p.ticker]} open={isOpen} onClick={() => toggleDetail(p.ticker)} />
                    <TierTag t={stances[p.ticker]?.tier} />

                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-neutral-400">
                        {p.price != null ? `$${p.price.toFixed(2)}` : '—'}
                        {p.changePct != null && (
                          <span className={`ml-1 ${cls(p.changePct)}`}>{pctRaw(p.changePct)}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-haze flex items-center gap-1">
                        {editing === key && !linked ? (
                          <input
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => saveShares(acct.id, p.ticker)}
                            onKeyDown={(e) => e.key === 'Enter' && saveShares(acct.id, p.ticker)}
                            className="w-16 bg-ink-900 border border-ink-700 rounded px-1 text-neutral-200"
                            inputMode="decimal"
                          />
                        ) : linked ? (
                          <span>{p.shares} sh</span>
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

                    {!linked && (
                      <button
                        onClick={() => doRemove(acct.id, p.ticker)}
                        className="text-ink-600 hover:text-red-400 text-xs"
                        title="Remove"
                      >
                        ✕
                      </button>
                    )}
                   </div>
                   {isOpen && (
                     <DecisionDetail
                       ticker={p.ticker}
                       a={analyses[p.ticker]}
                       agents={agents}
                       onFull={() => onAnalyze(p.ticker)}
                     />
                   )}
                  </li>
                );
              })}

              {acct.cash > 0 && (
                <li className="px-4 py-3 flex items-center gap-3">
                  <span className="font-mono text-sm text-neutral-400 w-16">Cash</span>
                  <div className="flex-1 text-[11px] text-haze">money market</div>
                  <div className="text-xs font-mono text-neutral-300">{money(acct.cash)}</div>
                </li>
              )}

              {!linked && (
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
              )}
            </ul>

            <div className="mt-2">
              {confirmDel === acct.id ? (
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-haze">
                    {linked
                      ? 'Remove this account? A future sync will bring it back unless you also disconnect it in SnapTrade.'
                      : 'Delete this account and all its holdings?'}
                  </span>
                  <button
                    onClick={() => doDeleteAccount(acct.id)}
                    disabled={delBusy}
                    className="px-2 py-1 rounded bg-red-500/90 text-white disabled:opacity-50"
                  >
                    {delBusy ? 'Deleting…' : 'Delete'}
                  </button>
                  <button
                    onClick={() => setConfirmDel(null)}
                    className="px-2 py-1 rounded bg-ink-800 text-haze"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDel(acct.id)}
                  className="text-[11px] text-haze hover:text-red-400"
                >
                  {linked ? 'remove account' : 'delete account'}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
