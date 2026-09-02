import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getPortfolio, setHolding, addTicker, removeTicker, importPositions, deleteAccount, renameAccount,
  getStances, getLatestAnalysis, getAgents, getDca, reviewHoldings,
} from '../api';
import BrokerLink from './BrokerLink';
import StrategyCheck from './StrategyCheck';
import { verdictStyle, stanceStyle, tierStyle, TIER_ORDER, stripMd } from './stance';

/* ------------------------------------------------------------------ helpers */

const money = (n, max = 0) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: max });
const signedMoney = (n) => (n == null ? '—' : `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`);
const pct = (n) => (n == null ? '' : `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1)}%`);
const pctRaw = (n) => (n == null ? '' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`);
const wpct = (n) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;
const tone = (n) => (n == null ? 'text-haze' : n >= 0 ? 'text-emerald-400' : 'text-[#f0685f]');

const ago = (ts) => {
  if (!ts) return '';
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

const UNRATED = '#565661';

/* ------------------------------------------------------ conviction strip */

/**
 * The signature: your money segmented by how much of it the council stands
 * behind. One glance = where the book sits with the strategy.
 */
function ConvictionStrip({ rows, total, onReview, reviewing }) {
  const buckets = useMemo(() => {
    const b = { HIGH: 0, MEDIUM: 0, LOW: 0, SPECULATIVE: 0, unrated: 0 };
    for (const r of rows) b[r.tier && b[r.tier] !== undefined ? r.tier : 'unrated'] += r.value;
    return b;
  }, [rows]);

  const flags = useMemo(() => {
    let trim = 0, exit = 0, needsReview = 0;
    for (const r of rows) {
      if (r.verdict === 'TRIM') trim++;
      if (r.verdict === 'EXIT') exit++;
      if (!r.analyzed || r.stale) needsReview++;
    }
    return { trim, exit, needsReview };
  }, [rows]);

  if (!total) return null;
  const segs = [
    ...TIER_ORDER.map((t) => ({ key: t, v: buckets[t], color: tierStyle(t).fg, label: tierStyle(t).label })),
    { key: 'unrated', v: buckets.unrated, color: UNRATED, label: 'UNRATED' },
  ].filter((s) => s.v > 0);

  const rated = 1 - buckets.unrated / total;

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between mb-1.5 gap-3">
        <p className="text-[10px] uppercase tracking-[0.2em] text-haze">The council’s read</p>
        <div className="flex items-center gap-3">
          <p className="text-[11px] font-mono text-ink-600">{Math.round(rated * 100)}% rated</p>
          <button
            onClick={onReview}
            disabled={reviewing}
            className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300 disabled:text-haze disabled:cursor-default"
          >
            {reviewing
              ? 'Reviewing the book…'
              : flags.needsReview > 0 ? `Review ${flags.needsReview} name${flags.needsReview > 1 ? 's' : ''}` : 'Re-review the book'}
          </button>
        </div>
      </div>
      <div className="flex h-3 w-full gap-px overflow-hidden rounded-md bg-ink-800">
        {segs.map((s) => (
          <div
            key={s.key}
            className="h-full transition-[width] duration-500"
            style={{ width: `${(s.v / total) * 100}%`, background: s.color }}
            title={`${s.label} — ${money(s.v)} (${Math.round((s.v / total) * 100)}%)`}
          />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        {segs.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
            <span className="text-neutral-200">{s.label}</span>
            <span className="font-mono text-haze">{Math.round((s.v / total) * 100)}%</span>
          </span>
        ))}
        {(flags.trim > 0 || flags.exit > 0) && (
          <span className="font-mono text-[#e0a33a] ml-auto">
            {flags.trim ? `${flags.trim} flagged to trim` : ''}{flags.trim && flags.exit ? ' · ' : ''}{flags.exit ? `${flags.exit} to exit` : ''}
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- next contribution */

function NextContribution({ onAnalyze }) {
  const [d, setD] = useState(null);
  useEffect(() => { getDca().then(setD).catch(() => setD(false)); }, []);
  if (!d || d.ready === false) return null;

  const target = d.pick || (d.buffer && { ticker: d.buffer.etf, reason: d.buffer.reason, buffer: true });
  if (!target) return null;

  return (
    <div className="card p-4">
      <p className="text-[10px] uppercase tracking-[0.2em] text-haze">Next contribution</p>
      <button
        onClick={() => onAnalyze(target.ticker)}
        className="mt-2 font-mono text-lg tracking-tight hover:text-indigo-300"
        style={{ color: target.buffer ? '#e0a33a' : '#34d399' }}
      >
        {target.ticker}
        {target.buffer && <span className="ml-1.5 text-[10px] uppercase tracking-wider text-haze">buffer</span>}
      </button>
      <p className="mt-1 text-[11px] text-haze leading-snug">{target.reason}</p>
    </div>
  );
}

/* ----------------------------------------------------------------- movers */

function Movers({ positions }) {
  const ranked = positions
    .filter((p) => p.changePct != null && p.value > 0)
    .sort((a, b) => b.changePct - a.changePct);
  if (ranked.length < 2) return null;
  const show = ranked.length <= 4 ? ranked : [...ranked.slice(0, 2), ...ranked.slice(-2)];

  return (
    <div className="card p-4">
      <p className="text-[10px] uppercase tracking-[0.2em] text-haze mb-2">Today</p>
      <ul className="space-y-1.5">
        {show.map((p) => (
          <li key={p.ticker} className="flex items-center justify-between text-[11px] font-mono tabular-nums">
            <span className="text-neutral-300">{p.ticker}</span>
            <span className={tone(p.changePct)}>{pctRaw(p.changePct)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- verdict chip */

function VerdictChip({ s, open, onClick }) {
  if (!s || !s.analyzed || !s.verdict) {
    return (
      <button onClick={onClick} title="Not yet reviewed by the council"
        className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-600 hover:text-haze">
        · unrated ·
      </button>
    );
  }
  const v = verdictStyle(s.verdict);
  const t = tierStyle(s.tier);
  return (
    <button
      onClick={onClick}
      title={[s.headline, s.stale ? '(stale — council hasn’t re-run recently)' : ''].filter(Boolean).join(' ') || s.verdict}
      className={`shrink-0 inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider
        transition-shadow ${s.stale ? 'opacity-50' : ''} ${open ? 'ring-1' : ''}`}
      style={{ color: v.fg, background: v.bg, boxShadow: open ? `inset 0 0 0 1px ${v.fg}` : undefined }}
    >
      <span className="font-semibold">{s.verdict}</span>
      {s.conviction != null && <span className="opacity-70">{s.conviction}</span>}
      {t && <span className="opacity-90" style={{ color: t.fg }}>{t.label}</span>}
    </button>
  );
}

/* ------------------------------------------------------------- decision detail */

const RED = '#f0685f', AMBER = '#e0a33a', COOL = '#7c8db5';

/** Build the flag chips for a run — order matters, most serious first. */
function verdictFlags(c) {
  const out = [];
  if (c.broken) out.push(['Thesis broken', RED]);
  if (c.downtrendExit) out.push(['Downtrend + weak fundamentals', RED]);
  else if (c.downtrend) out.push(['In a downtrend', AMBER]);
  if (c.concentrationTrim) out.push([`Oversized — ${c.overCapX ? c.overCapX + '× its cap' : 'trim to size'}`, AMBER]);
  if (c.atCap && !c.concentrationTrim) out.push(['At cap — would add otherwise', COOL]);
  if (c.entryClear === false && !c.broken && !c.downtrend) out.push(['Entry not clear', AMBER]);
  if (c.structuralBear && !c.broken) out.push(['Structural bear case', AMBER]);
  return out;
}

function PositionLine({ econ }) {
  if (!econ || econ.avgCost == null) return null;
  const up = econ.unreal >= 0;
  return (
    <p className="text-[11px] font-mono text-haze">
      <span className="uppercase tracking-wider text-[10px] text-ink-600">position </span>
      {econ.shares} sh @ ${econ.avgCost.toFixed(2)} avg ·{' '}
      <span className={up ? 'text-emerald-400' : 'text-[#f0685f]'}>
        {up ? '+' : '−'}{Math.abs(econ.unrealPct * 100).toFixed(0)}% ({up ? '+' : '−'}{money(Math.abs(econ.unreal))})
      </span>
    </p>
  );
}

const fnum = (x, suffix = '%') => (x == null ? null : `${x >= 0 ? '' : ''}${x.toFixed(0)}${suffix}`);

function FundamentalsLine({ f }) {
  if (!f?.available) return null;
  const bits = [
    fnum(f.revGrowth) && `rev ${fnum(f.revGrowth)}`,
    fnum(f.netMargin) && `net margin ${fnum(f.netMargin)}`,
    f.debtToEquity != null && `D/E ${f.debtToEquity.toFixed(1)}`,
    f.pe != null && `P/E ${f.pe.toFixed(0)}`,
  ].filter(Boolean);
  if (!bits.length) return null;
  return (
    <p className="text-[10px] font-mono text-ink-600">
      <span className="uppercase tracking-wider">fundamentals </span>{bits.join('  ·  ')}
    </p>
  );
}

function DecisionDetail({ ticker, a, econ, agents, onFull }) {
  if (a === undefined) {
    return <div className="px-4 pb-3 pl-6 text-[11px] text-haze animate-pulse">Loading the council’s notes…</div>;
  }
  if (a === null) {
    return (
      <div className="px-4 pb-3 pl-6 text-[11px] text-haze">
        The council hasn’t reviewed {ticker} yet.{' '}
        <button onClick={onFull} className="text-indigo-400 hover:text-indigo-300">Convene it →</button>
      </div>
    );
  }

  const v = verdictStyle(a.verdict);
  const t = tierStyle(a.tier);
  const c = a.computed || {};
  const flags = verdictFlags(c);

  return (
    <div className="px-4 pb-4 pt-3 pl-6 space-y-3 border-t hairline bg-ink-950/40">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2 font-mono text-xs">
          <span className="font-semibold tracking-wide" style={{ color: v.fg }}>{a.verdict} · {a.conviction}/10</span>
          {c.score100 != null && <span className="text-ink-600">council score {c.score100}</span>}
          {t && <span className="tracking-wider" style={{ color: t.fg }}>{t.label} conviction</span>}
        </div>
        <button onClick={onFull} className="shrink-0 text-[11px] text-indigo-400 hover:text-indigo-300">full analysis →</button>
      </div>

      {t && a.tierReasons?.length > 0 && (
        <p className="text-[10px] text-ink-600 font-mono -mt-1.5">{a.tierReasons.join('  ·  ')}</p>
      )}

      <PositionLine econ={econ || a.holdings?.econ} />
      <FundamentalsLine f={a.fundamentals} />

      {a.headline && <p className="text-sm text-neutral-100 font-medium">{stripMd(a.headline)}</p>}
      {a.rationale && <p className="text-xs text-neutral-400 leading-relaxed">{stripMd(a.rationale)}</p>}

      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {flags.map(([label, col]) => (
            <span key={label} className="text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded"
              style={{ color: col, background: `${col}22` }}>{label}</span>
          ))}
        </div>
      )}

      {agents.length > 0 && a.agents && (
        <ul className="space-y-1 pt-0.5">
          {agents.map((ag) => {
            const r = a.agents[ag.id];
            if (!r) return null;
            const st = stanceStyle(r.stance);
            return (
              <li key={ag.id} className="text-[11px] flex gap-2.5 items-baseline">
                <span className="w-12 shrink-0 font-mono" style={{ color: ag.color }}>{ag.name}</span>
                <span className="w-14 shrink-0 font-mono text-[10px] uppercase" style={{ color: st.fg }}>{st.label}</span>
                <span className="text-haze truncate">{stripMd(r.note || r.headline || '')}</span>
              </li>
            );
          })}
        </ul>
      )}

      {a.catalyst && (
        <p className="text-[11px] text-neutral-400">
          <span className="font-mono text-[10px] uppercase tracking-wider text-indigo-400">Catalyst </span>
          {stripMd(a.catalyst)}
        </p>
      )}
      {a.ts && <p className="text-[10px] font-mono text-ink-600">reviewed {ago(a.ts)}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ holding row */

function Holding({ p, weight, stance, isOpen, linked, editing, draft, setDraft, onToggle, onEdit, onSaveShares, onRemove, detail }) {
  const tier = stance?.tier ? tierStyle(stance.tier) : null;
  const railColor = tier ? tier.fg : UNRATED;

  return (
    <li className="relative">
      {/* weight of the book, drawn behind the row */}
      <div className="absolute inset-y-0 left-0 pointer-events-none"
        style={{ width: `${Math.min(weight * 100, 100)}%`, background: `linear-gradient(90deg, ${railColor}33, ${railColor}00)` }} />
      {/* conviction rail */}
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: railColor }} />

      <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 pl-5">
        <div className="w-[58px] shrink-0">
          <button onClick={onToggle} className="font-mono text-sm text-neutral-100 hover:text-indigo-300 block text-left leading-tight">
            {p.ticker}
          </button>
          <span className="font-mono text-[10px] text-ink-600">{p.shares} sh</span>
        </div>

        <VerdictChip s={stance} open={isOpen} onClick={onToggle} />

        {/* the council's one line, filling the row */}
        <button onClick={onToggle} className="flex-1 min-w-0 text-left hidden md:block">
          <span className="text-[11px] text-haze truncate block hover:text-neutral-400">
            {stance?.analyzed ? stripMd(stance.summary || stance.headline || '') : ''}
          </span>
        </button>
        <div className="flex-1 min-w-0 md:hidden" />

        {/* price + day move */}
        <div className="font-mono text-[11px] tabular-nums text-right w-[92px]">
          <div className="text-neutral-400">{p.price != null ? `$${p.price.toFixed(2)}` : '—'}</div>
          {p.changePct != null && <div className={tone(p.changePct)}>{pctRaw(p.changePct)}</div>}
        </div>

        {/* share of the book */}
        <div className="hidden sm:block font-mono text-[11px] tabular-nums text-right w-[44px] text-haze">
          {wpct(weight)}
        </div>

        {/* value + total return */}
        <div className="font-mono text-[11px] tabular-nums text-right w-[84px]">
          <div className="text-neutral-200">{p.value ? money(p.value) : ''}</div>
          {p.gainPct != null && <div className={tone(p.gainPct)}>{pct(p.gainPct)}</div>}
        </div>

        {/* manual accounts: edit shares / remove, on their own line */}
        {!linked && (
          <div className="basis-full pl-[58px] text-[10px] font-mono text-ink-600">
            {editing ? (
              <input
                autoFocus value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={onSaveShares}
                onKeyDown={(e) => e.key === 'Enter' && onSaveShares()}
                className="w-20 bg-ink-800 border border-ink-700 rounded px-1 text-neutral-200"
                inputMode="decimal"
              />
            ) : (
              <button onClick={onEdit} className="hover:text-haze">{p.shares ? 'edit shares' : 'set shares'}</button>
            )}
            <button onClick={onRemove} className="ml-3 text-ink-600 hover:text-[#f0685f]" title="Remove holding">remove</button>
          </div>
        )}
      </div>

      {isOpen && detail}
    </li>
  );
}

/* ------------------------------------------------------------------ main */

export default function Portfolio({ onAnalyze }) {
  const [data, setData] = useState(null);
  const [stances, setStances] = useState({});
  const [agents, setAgents] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [analyses, setAnalyses] = useState({});
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(null);
  const [newTicker, setNewTicker] = useState('');
  const [importing, setImporting] = useState(null);
  const [importText, setImportText] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);
  const [delBusy, setDelBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const pollRef = useRef(null);

  const load = () => getPortfolio().then(setData).catch((e) => setErr(e.message));
  const loadStances = () =>
    getStances().then((r) => { setStances(r.stances || {}); return r; }).catch(() => null);
  useEffect(() => { load(); }, []);
  useEffect(() => { loadStances(); getAgents().then(setAgents).catch(() => {}); }, []);
  useEffect(() => () => clearInterval(pollRef.current), []);

  // "Review the book" — kick off a server-side council pass over every holding,
  // then poll the stances as verdicts land in Firestore.
  const reviewBook = async () => {
    if (reviewing) return;
    setReviewing(true);
    try { await reviewHoldings(); } catch (e) { setErr(e.message); setReviewing(false); return; }
    const started = Date.now();
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const r = await loadStances();
      const done = r && r.counts && (r.counts.none || 0) === 0;
      if (done || Date.now() - started > 4 * 60 * 1000) {
        clearInterval(pollRef.current);
        setReviewing(false);
      }
    }, 12000);
  };

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
    try { setData(await setHolding(acct, ticker, { shares: Number(draft) || 0 })); } catch (e) { setErr(e.message); }
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
    setDelBusy(true); setErr('');
    try { const next = await deleteAccount(acctId); setConfirmDel(null); setData(next); }
    catch (e) { setErr(e.message); } finally { setDelBusy(false); }
  };
  const saveName = async (acct) => {
    setRenaming(null);
    try { setData(await renameAccount(acct, nameDraft)); } catch (e) { setErr(e.message); }
  };
  const doImport = async (acct) => {
    setImportBusy(true); setErr('');
    try {
      const { portfolio } = await importPositions(acct, importText);
      setData(portfolio); setImporting(null); setImportText('');
    } catch (e) { setErr(e.message); } finally { setImportBusy(false); }
  };

  if (err) return <p className="text-xs text-[#f0685f]">{err}</p>;
  if (!data) return <p className="text-xs text-haze animate-pulse">Loading portfolio…</p>;

  const { totals } = data;
  const hasValue = totals.value > 0;

  // every position, flattened, for the conviction strip
  const allRows = data.accounts.flatMap((acct) =>
    (acct.positions || []).map((p) => {
      const s = stances[p.ticker];
      return {
        value: p.value || 0,
        tier: s?.tier || null,
        verdict: s?.analyzed ? s?.verdict : null,
        analyzed: !!s?.analyzed,
        stale: !!s?.stale,
      };
    }),
  );

  return (
    <div className="space-y-6">
      {/* ---- hero: the book ---- */}
      <header>
        <p className="text-[10px] uppercase tracking-[0.24em] text-haze">Portfolio</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-mono text-[40px] leading-none tracking-tight text-neutral-50">{money(totals.value)}</span>
          <span className={`font-mono text-sm ${tone(totals.dayChange)}`}>{signedMoney(totals.dayChange)} today</span>
          {totals.gain != null && (
            <span className={`font-mono text-sm ${tone(totals.gain)}`}>
              {signedMoney(totals.gain)} <span className="text-ink-600">({pct(totals.gainPct)})</span> all&#8209;time
            </span>
          )}
        </div>
        {hasValue
          ? <ConvictionStrip rows={allRows} total={totals.value} onReview={reviewBook} reviewing={reviewing} />
          : <p className="mt-3 text-xs text-haze">Link a broker or paste your positions to see real values and the council’s read.</p>}
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* ---- main column: accounts + holdings ---- */}
        <div className="space-y-6 min-w-0">
          <BrokerLink onSynced={setData} />

          {data.accounts.map((acct) => {
            const linked = acct.linked;
            return (
              <section key={acct.id}>
                <div className="flex items-baseline justify-between mb-2 gap-3">
                  <div className="min-w-0">
                    {renaming === acct.id ? (
                      <input
                        autoFocus value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onBlur={() => saveName(acct.id)}
                        onKeyDown={(e) => e.key === 'Enter' && saveName(acct.id)}
                        placeholder="Account name"
                        className="w-44 bg-ink-800 border border-ink-700 rounded px-1.5 text-sm text-neutral-100"
                      />
                    ) : (
                      <h2
                        className="text-sm font-medium text-neutral-100 hover:text-indigo-300 cursor-text inline-flex items-center gap-2"
                        onClick={() => { setRenaming(acct.id); setNameDraft(acct.label); }}
                        title="Rename"
                      >
                        {acct.label}
                        {linked && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" title={`synced ${ago(acct.syncedAt)}`} />}
                      </h2>
                    )}
                    <p className="text-[11px] text-haze truncate">
                      {acct.sub}{acct.dcaNote ? ` · ${acct.dcaNote}` : ''}
                      {linked && <span className="text-emerald-500/70"> · synced {ago(acct.syncedAt)}</span>}
                    </p>
                  </div>
                  <div className="flex items-baseline gap-3 shrink-0">
                    {!linked && (
                      <button onClick={() => { setImporting(acct.id); setImportText(''); }}
                        className="text-[11px] text-indigo-400 hover:text-indigo-300">paste positions</button>
                    )}
                    <span className="font-mono text-sm text-neutral-300 tabular-nums">{money(acct.value)}</span>
                  </div>
                </div>

                {importing === acct.id && !linked && (
                  <div className="card p-3 mb-2 space-y-2">
                    <p className="text-[11px] text-haze">
                      Paste from your broker — any format works (a symbol and share count per line, CSV,
                      or the copied positions table). Shares first, cost basis second if you have it.
                    </p>
                    <textarea
                      autoFocus value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                      rows={6} placeholder="One position per line"
                      className="w-full bg-ink-950 border border-ink-800 rounded p-2 text-xs font-mono"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => doImport(acct.id)} disabled={importBusy || !importText.trim()}
                        className="h-8 px-4 rounded bg-indigo-500 hover:bg-indigo-400 text-white text-xs disabled:opacity-50">
                        {importBusy ? 'Importing…' : 'Import'}
                      </button>
                      <button onClick={() => setImporting(null)} className="h-8 px-3 rounded bg-ink-800 text-xs text-haze">Cancel</button>
                    </div>
                  </div>
                )}

                <ul className="card divide-y divide-ink-800/70 overflow-hidden">
                  {acct.positions.map((p) => (
                    <Holding
                      key={p.ticker}
                      p={p}
                      weight={totals.value ? (p.value || 0) / totals.value : 0}
                      stance={stances[p.ticker]}
                      isOpen={expanded === p.ticker}
                      linked={linked}
                      editing={editing === `${acct.id}:${p.ticker}`}
                      draft={draft}
                      setDraft={setDraft}
                      onToggle={() => toggleDetail(p.ticker)}
                      onEdit={() => { setEditing(`${acct.id}:${p.ticker}`); setDraft(String(p.shares || '')); }}
                      onSaveShares={() => saveShares(acct.id, p.ticker)}
                      onRemove={() => doRemove(acct.id, p.ticker)}
                      detail={
                        <DecisionDetail
                          ticker={p.ticker}
                          a={analyses[p.ticker]}
                          econ={stances[p.ticker]?.econ}
                          agents={agents}
                          onFull={() => onAnalyze(p.ticker)}
                        />
                      }
                    />
                  ))}

                  {acct.cash > 0 && (
                    <li className="relative flex items-center gap-3 px-4 py-3 pl-5">
                      <div className="absolute inset-y-0 left-0 w-[3px] bg-ink-700" />
                      <span className="font-mono text-sm text-neutral-400 w-[58px]">Cash</span>
                      <span className="flex-1 text-[11px] text-ink-600">money market</span>
                      <span className="font-mono text-[11px] tabular-nums text-neutral-300">{money(acct.cash)}</span>
                    </li>
                  )}

                  {!linked && (
                    <li className="px-4 py-2 pl-5">
                      {adding === acct.id ? (
                        <input
                          autoFocus value={newTicker}
                          onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
                          onBlur={() => doAdd(acct.id)}
                          onKeyDown={(e) => e.key === 'Enter' && doAdd(acct.id)}
                          placeholder="Ticker"
                          className="w-24 bg-ink-800 border border-ink-700 rounded px-2 py-1 text-xs font-mono"
                        />
                      ) : (
                        <button onClick={() => setAdding(acct.id)} className="text-xs text-ink-600 hover:text-haze">+ add holding</button>
                      )}
                    </li>
                  )}
                </ul>

                <div className="mt-2">
                  {confirmDel === acct.id ? (
                    <div className="flex flex-wrap items-center gap-3 text-[11px]">
                      <span className="text-haze">
                        {linked
                          ? 'Remove this account? A future sync brings it back unless you disconnect it in SnapTrade.'
                          : 'Delete this account and all its holdings?'}
                      </span>
                      <button onClick={() => doDeleteAccount(acct.id)} disabled={delBusy}
                        className="px-2 py-1 rounded bg-[#f0685f]/90 text-white disabled:opacity-50">
                        {delBusy ? 'Deleting…' : 'Delete'}
                      </button>
                      <button onClick={() => setConfirmDel(null)} className="px-2 py-1 rounded bg-ink-800 text-haze">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDel(acct.id)} className="text-[11px] text-ink-600 hover:text-[#f0685f]">
                      {linked ? 'remove account' : 'delete account'}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        {/* ---- right rail: allocation ---- */}
        <aside className="lg:sticky lg:top-20 self-start space-y-4">
          <StrategyCheck />
          <NextContribution onAnalyze={onAnalyze} />
          <Movers positions={data.accounts.flatMap((a) => a.positions || [])} />
        </aside>
      </div>
    </div>
  );
}
