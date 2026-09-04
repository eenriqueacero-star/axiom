import { useEffect, useMemo, useRef, useState } from 'react';
import { getPortfolio, getStrategyDiagnostics, getFloor, getFloorLive, getStances, getLatestAnalysis } from '../api';
import { useNotifications } from '../hooks/useNotifications';
import { useLivePrices } from '../hooks/useLivePrices';
import Icon, { AGENT_IDS } from '../ui/Icon';
import Sheet from '../ui/Sheet';
import { AgentSheet } from './sheets/AgentSheet';
import { HoldingsSheet } from './sheets/HoldingsSheet';
import { RulebookSheet } from './sheets/RulebookSheet';
import Queue from '../components/Queue';

const signed = (n) => `${n >= 0 ? '+' : '−'}$${Math.abs(Math.round(n)).toLocaleString()}`;
const money = (n) => `$${Math.round(n || 0).toLocaleString()}`;
const pctStr = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`;

const KIND_ICON = { news: 'news', filing: 'filing', insider: 'insider', congress: 'congress', move: 'move', rating: 'rating', scout: 'scout', desk: 'desk', opportunity: 'opportunity', macro: 'macro' };
const TIER = {
  HIGH: { c: 'var(--good)' }, MEDIUM: { c: '#5a6b8c' }, LOW: { c: 'var(--warn)' }, SPECULATIVE: { c: 'var(--crit)' },
};
const VERDICT = {
  ADD: { c: 'var(--good)', bg: 'rgba(75,173,131,0.13)' },
  HOLD: { c: 'var(--muted)', bg: 'rgba(255,255,255,0.04)' },
  TRIM: { c: 'var(--warn)', bg: 'rgba(214,154,62,0.13)' },
  EXIT: { c: 'var(--crit)', bg: 'rgba(224,87,78,0.13)' },
};

function relTime(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function useCountUp(target, ms = 900) {
  const [n, setN] = useState(target == null ? null : 0);
  const fromRef = useRef(0);
  useEffect(() => {
    if (target == null) { setN(null); fromRef.current = 0; return; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(target); fromRef.current = target; return; }
    const from = fromRef.current;
    let raf; const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      const eased = from + (target - from) * (1 - Math.pow(1 - p, 3));
      setN(Math.round(eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return n;
}

function Value({ book, size = 'lg' }) {
  const n = useCountUp(book.value == null ? null : Math.round(book.value));
  const cls = size === 'xl'
    ? 'font-wide text-[54px] font-bold leading-none tracking-tight text-lit tabular-nums'
    : 'font-wide text-[38px] font-bold leading-none tracking-tight text-lit tabular-nums';
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className={cls}>{n == null ? '—' : `$${n.toLocaleString()}`}</span>
      {book.dayChange != null && (
        <span className={`mono flex items-center gap-1 text-xs ${book.dayChange >= 0 ? 'text-good glow-good' : 'text-crit glow-crit'}`}>
          <Icon name="up" size={9} className={book.dayChange >= 0 ? '' : 'rotate-180'} />
          {signed(book.dayChange)}{book.dayPct != null ? ` · ${pctStr(book.dayPct * 100)}` : ''} today
        </span>
      )}
      {book.gain != null && (
        <span className="mono text-[10px] text-faint">
          {book.gain >= 0 ? '+' : '−'}{money(Math.abs(book.gain))} all-time
        </span>
      )}
    </div>
  );
}

function ConvictionBar({ conviction }) {
  if (!conviction) return <div className="mt-3 mono text-[10px] text-faint">council read loading…</div>;
  const seg = [
    ['high', 'HIGH', 'var(--good)'], ['med', 'MED', '#5a6b8c'],
    ['low', 'LOW', 'var(--warn)'], ['spec', 'SPEC', 'var(--crit)'],
  ];
  return (
    <div className="mt-3 w-full max-w-[320px]">
      <div className="flex h-[3px] gap-[1.5px] overflow-hidden rounded-sm">
        {seg.map(([k, , c]) => <span key={k} style={{ width: `${conviction[k] * 100}%`, background: c }} />)}
      </div>
      <div className="mt-1.5 flex justify-between mono text-[9px] tracking-[0.08em] text-faint">
        {seg.map(([k, label]) => <span key={k}>{label} {Math.round(conviction[k] * 100)}</span>)}
      </div>
    </div>
  );
}

/* a row of compact stat tiles — turns the top band into a real dashboard */
function StatTiles({ book, cash, sleeve, breaches, names, contribution }) {
  const tiles = [
    { k: 'Today', v: book.dayChange == null ? '—' : signed(book.dayChange), sub: book.dayPct != null ? pctStr(book.dayPct * 100) : '', tone: book.dayChange >= 0 ? 'good' : 'crit' },
    { k: 'Unrealized', v: book.gain == null ? '—' : `${book.gain >= 0 ? '+' : '−'}${money(Math.abs(book.gain))}`, sub: book.gainPct != null ? pctStr(book.gainPct * 100) : '', tone: book.gain >= 0 ? 'good' : 'crit' },
    { k: 'Cash', v: money(cash), sub: book.value ? `${Math.round(cash / book.value * 100)}% of book` : '' },
    { k: 'Core sleeve', v: sleeve ? `${Math.round(sleeve.corePct * 100)}%` : '—', sub: sleeve ? `target ${Math.round((sleeve.targetCore || 0.5) * 100)}%` : '' },
    { k: 'Breaches', v: String(breaches), sub: breaches ? 'see rulebook' : 'all clear', tone: breaches ? 'crit' : '' },
    { k: 'Names', v: String(names), sub: contribution ? `+${money(contribution)}/wk in` : '' },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {tiles.map((t) => (
        <div key={t.k} className="panel rounded-lg px-3 py-2.5">
          <div className="label !text-[9px]">{t.k}</div>
          <div className={`mt-1 font-wide text-[16px] font-semibold tabular-nums ${t.tone === 'good' ? 'text-good' : t.tone === 'crit' ? 'text-crit' : 'text-text'}`}>{t.v}</div>
          {t.sub && <div className="mono text-[9px] text-faint">{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function CouncilRead({ ticker, onRun }) {
  const [a, setA] = useState(undefined);
  useEffect(() => {
    let ok = true;
    getLatestAnalysis(ticker).then((r) => ok && setA(r?.found ? r.analysis : null)).catch(() => ok && setA(null));
    return () => { ok = false; };
  }, [ticker]);
  if (a === undefined) return <p className="px-1 pb-3 text-[11px] text-faint">Pulling the council's read…</p>;
  if (a === null) return (
    <div className="px-1 pb-3">
      <p className="text-[11px] text-faint">No council run on {ticker} yet.</p>
      <button onClick={() => onRun(ticker)} className="mt-1.5 btn-accent h-7 px-3 text-[10px]">run the council →</button>
    </div>
  );
  return (
    <div className="space-y-2 px-1 pb-3.5">
      {a.headline && <p className="text-[12px] leading-snug text-text">{a.headline}</p>}
      {(a.impact || a.rationale) && <p className="text-[11px] leading-relaxed text-muted">{a.impact || a.rationale}</p>}
      {Array.isArray(a.agents) && (
        <ul className="space-y-0.5 pt-0.5">
          {a.agents.map((ag) => (
            <li key={ag.id || ag.name} className="text-[10px] leading-snug text-faint">
              <span className="text-muted">{ag.name}</span>{ag.stance ? ` — ${ag.stance}` : ''}{ag.note ? `: ${ag.note}` : ''}
            </li>
          ))}
        </ul>
      )}
      <button onClick={() => onRun(ticker)} className="btn-accent h-7 px-3 text-[10px]">run it again →</button>
    </div>
  );
}

/* the hero: every position as a rich 2-line row, expandable to the council's read */
function Holdings({ rows, total, stances, onRun, dense }) {
  const st = stances?.stances || {};
  const [open, setOpen] = useState(null);
  if (!rows.length) return <p className="px-1 py-6 text-[11px] text-faint">No positions loaded.</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((p) => {
        const w = (p.value || 0) / (total || 1);
        const s = st[p.ticker] || {};
        const v = VERDICT[s.verdict];
        const tier = TIER[s.tier];
        const dp = p.changePct;
        const gp = p.gainPct;
        const isOpen = open === p.ticker;
        return (
          <li key={p.ticker + p.account}>
            <button onClick={() => setOpen(isOpen ? null : p.ticker)}
              className="press grid w-full grid-cols-[1fr_auto] items-start gap-3 py-3 text-left">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="mono text-[13px] font-medium text-text">{p.ticker}</span>
                  {v ? (
                    <span className="mono text-[8px] px-1.5 py-0.5 rounded" style={{ color: v.c, background: v.bg }}>{s.verdict}</span>
                  ) : tier ? (
                    <span className="mono text-[8px]" style={{ color: tier.c }}>{s.tier}</span>
                  ) : null}
                  {s.stale && <span className="mono text-[8px] text-faint">stale</span>}
                  <Icon name="chevron" size={11} className={`text-faint transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="relative h-[3px] w-24 shrink-0 overflow-hidden rounded-sm bg-line-2">
                    <i className="absolute inset-y-0 left-0 rounded-sm bg-muted" style={{ width: `${Math.min(100, w / 0.4 * 100)}%` }} />
                  </span>
                  <span className="mono text-[9px] text-faint tabular-nums">{Math.round(w * 100)}% · {p.shares} sh @ ${Number(p.costBasis || 0).toFixed(2)}</span>
                </div>
                {(s.summary || s.headline) && (
                  <p className="mt-1.5 line-clamp-1 max-w-[46ch] text-[10.5px] leading-tight text-muted">{s.summary || s.headline}</p>
                )}
              </div>
              <div className="text-right">
                <div className="mono text-[12px] text-text tabular-nums">{money(p.value)}</div>
                <div className="mt-1.5 flex items-center justify-end gap-2 mono text-[9px] tabular-nums">
                  {gp != null && <span className={gp >= 0 ? 'text-good' : 'text-crit'}>{pctStr(gp * 100)}</span>}
                  <span className={dp == null ? 'text-faint' : dp >= 0 ? 'text-good' : 'text-crit'}>{dp == null ? '—' : `${pctStr(dp)} d`}</span>
                </div>
                {s.conviction != null && <div className="mt-1 mono text-[9px] text-faint">conv {s.conviction}/10</div>}
              </div>
            </button>
            {isOpen && <CouncilRead ticker={p.ticker} onRun={onRun} />}
          </li>
        );
      })}
    </ul>
  );
}

function Allocation({ diag, onRulebook }) {
  const sectors = diag?.sectors?.slice(0, 5) || [];
  const core = diag?.sleeve ? Math.round(diag.sleeve.corePct * 100) : null;
  const target = diag?.sleeve ? Math.round((diag.sleeve.targetCore || 0.5) * 100) : 50;
  return (
    <div>
      <button onClick={onRulebook} className="label mb-2.5 flex items-center gap-1.5">
        <i className="h-1 w-1 rounded-full bg-muted" /> Allocation
      </button>
      <div className="flex flex-col gap-1.5">
        {core != null && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="w-16 shrink-0 text-muted">Core</span>
            <span className="relative h-[3px] flex-1 overflow-hidden rounded-sm bg-line-2">
              <i className="absolute inset-y-0 left-0 bg-muted" style={{ width: `${core}%` }} />
              <i className="absolute inset-y-0 w-px bg-lit/60" style={{ left: `${target}%` }} />
            </span>
            <span className="mono w-9 text-right text-muted tabular-nums">{core}%</span>
          </div>
        )}
        {sectors.map((s) => {
          const p = Math.round(s.pct * 100);
          const over = s.pct > 0.35;
          return (
            <div key={s.name} className="flex items-center gap-2 text-[11px]">
              <span className="w-16 shrink-0 truncate text-muted">{s.name}</span>
              <span className="relative h-[3px] flex-1 overflow-hidden rounded-sm bg-line-2">
                <i className={`absolute inset-y-0 left-0 ${over ? 'bg-crit' : 'bg-muted'}`} style={{ width: `${Math.min(100, p / 35 * 100)}%` }} />
              </span>
              <span className={`mono w-9 text-right tabular-nums ${over ? 'text-crit' : 'text-muted'}`}>{p}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Breaches({ flags, onRulebook }) {
  if (!flags?.length) {
    return (
      <div>
        <div className="label mb-2 flex items-center gap-1.5"><i className="h-1 w-1 rounded-full bg-good" /> Rulebook</div>
        <p className="text-[11px] text-faint">Every rule holds. Nothing for the desk to flag.</p>
      </div>
    );
  }
  return (
    <div>
      <button onClick={onRulebook} className="label mb-2 flex items-center gap-1.5 text-warn">
        <Icon name="warn" size={11} /> {flags.length} breach{flags.length !== 1 ? 'es' : ''}
      </button>
      <ul className="flex flex-col gap-1.5">
        {flags.slice(0, 5).map((f, i) => (
          <li key={i} className="flex gap-2 text-[11px] leading-snug text-muted">
            <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-crit" />
            <span>{typeof f === 'string' ? f : f.label || f.msg || f.rule}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pulse({ items, onOpen }) {
  return (
    <div>
      <button onClick={onOpen} className="label mb-2.5 flex items-center gap-1.5">
        <i className="h-1 w-1 rounded-full bg-muted" /> Pulse
      </button>
      <div className="flex flex-col gap-2">
        {items.map((n) => (
          <button key={n.id} onClick={onOpen}
            className="press grid grid-cols-[13px_1fr_auto] items-center gap-2.5 rounded-md px-1 py-0.5 text-left text-xs text-text">
            <Icon name={KIND_ICON[n.kind] || 'desk'} size={13} className="text-muted" />
            <span className="truncate">{n.title}</span>
            <time className="mono text-[10px] text-faint">{relTime(n.ts)}</time>
          </button>
        ))}
        {items.length === 0 && (
          <p className="text-[11px] text-faint">Nothing on the wire. News, filings and the boss's reads land here.</p>
        )}
      </div>
    </div>
  );
}

export default function Book({ desktop, onOpenAgent, onOpenAlert, onAskBoss, activeTicker }) {
  const [pf, setPf] = useState(null);
  const [diag, setDiag] = useState(null);
  const [floor, setFloor] = useState(null);
  const [live, setLive] = useState(null);
  const [stances, setStances] = useState(null);
  const [err, setErr] = useState('');
  const [sheet, setSheet] = useState(null);
  const { items: notifs } = useNotifications(24);

  useEffect(() => {
    let alive = true;
    Promise.all([
      getPortfolio().catch(() => null),
      getStrategyDiagnostics().catch(() => null),
      getFloor().catch(() => null),
      getStances().catch(() => null),
    ]).then(([p, d, f, s]) => {
      if (!alive) return;
      setPf(p); setDiag(d); setFloor(f); setStances(s);
      if (!p && !d) setErr('Could not reach the desk.');
    });
    const poll = () => getFloorLive().then((l) => alive && setLive(l)).catch(() => {});
    poll();
    const id = setInterval(poll, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const book = useMemo(() => {
    const t = pf?.totals || {};
    return {
      value: t.value ?? diag?.total ?? null,
      dayChange: t.dayChange ?? null,
      dayPct: t.dayChangePct ?? null,
      gain: t.gain ?? null,
      gainPct: t.gainPct ?? null,
    };
  }, [pf, diag]);

  const cash = useMemo(() => (pf?.accounts || []).reduce((s, a) => s + (a.cash || 0), 0), [pf]);

  const rows = useMemo(() => {
    const out = [];
    for (const acct of pf?.accounts || []) {
      for (const p of acct.positions || []) {
        if (!p.ticker || (p.shares || 0) <= 0) continue;
        out.push({ ...p, account: acct.label || acct.id || '' });
      }
    }
    return out.sort((x, y) => (y.value || 0) - (x.value || 0));
  }, [pf]);

  const liveTickers = useMemo(() => [...new Set(rows.map((r) => r.ticker))], [rows]);
  const quotes = useLivePrices(liveTickers, 8000);

  // Overlay live quotes onto the last portfolio snapshot — price, position
  // value, day % and unrealized % all move every few seconds without a full
  // portfolio refetch. Falls back to the snapshot value whenever a ticker
  // has no live quote yet.
  const liveRows = useMemo(() => rows.map((r) => {
    const q = quotes[r.ticker];
    if (!q || q.error || q.price == null) return r;
    const price = q.price;
    const value = price * (r.shares || 0);
    const changePct = q.changePct ?? r.changePct;
    const gainPct = r.costBasis > 0 ? (price - r.costBasis) / r.costBasis : r.gainPct;
    return { ...r, price, value, changePct, gainPct };
  }), [rows, quotes]);

  const liveBook = useMemo(() => {
    const value = liveRows.reduce((s, r) => s + (r.value || 0), 0) + cash;
    if (!value) return book;
    const dayChange = liveRows.reduce((s, r) => {
      if (r.changePct == null || !r.value) return s;
      return s + r.value * (r.changePct / (100 + r.changePct));
    }, 0);
    return { ...book, value, dayChange, dayPct: value ? (dayChange / (value - dayChange)) * 100 : book.dayPct };
  }, [liveRows, cash, book]);

  const conviction = useMemo(() => {
    const c = stances?.tierCounts;
    if (c) {
      const tot = (c.HIGH || 0) + (c.MEDIUM || 0) + (c.LOW || 0) + (c.SPECULATIVE || 0);
      if (tot > 0) return {
        high: (c.HIGH || 0) / tot, med: (c.MEDIUM || 0) / tot,
        low: (c.LOW || 0) / tot, spec: (c.SPECULATIVE || 0) / tot,
      };
    }
    return null;
  }, [stances]);

  const flags = diag?.flags || [];
  const workingCount = useMemo(() => {
    if (!live) return 0;
    const a = live.agents || {};
    return AGENT_IDS.filter((id) => a[id]?.busy).length || Object.values(live.busy || {}).filter(Boolean).length;
  }, [live]);

  const openRow = (t) => onOpenAgent?.(t);

  const statusRow = (
    <div className="flex items-center justify-between mono text-[10px] tracking-[0.12em] text-faint">
      <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toUpperCase()} ET</span>
      <span className="flex items-center gap-1.5 text-muted">
        <i className="h-1.5 w-1.5 rounded-full bg-good shadow-[0_0_8px_var(--zen)]" />
        {workingCount ? `${workingCount} on the floor` : 'desk quiet'}
      </span>
    </div>
  );

  const sheets = (
    <>
      <Sheet open={sheet?.startsWith('agent:')} onClose={() => setSheet(null)} labelledBy="sheet-agent-title">
        {sheet?.startsWith('agent:') && (
          <AgentSheet id={sheet.slice(6)} live={live?.agents?.[sheet.slice(6)]} floor={floor} ticker={activeTicker}
            onAnalyze={(t) => { setSheet(null); onOpenAgent?.(t); }} />
        )}
      </Sheet>
      <Sheet open={sheet === 'holdings'} onClose={() => setSheet(null)} labelledBy="sheet-holdings-title">
        {sheet === 'holdings' && <HoldingsSheet pf={pf} diag={diag} stances={stances}
          onAnalyze={(t) => { setSheet(null); onOpenAgent?.(t); }} />}
      </Sheet>
      <Sheet open={sheet === 'rulebook'} onClose={() => setSheet(null)} labelledBy="sheet-rulebook-title">
        {sheet === 'rulebook' && <RulebookSheet diag={diag} />}
      </Sheet>
    </>
  );

  if (desktop) {
    return (
      <div className="flex h-full">
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <Queue onRun={openRow} onAskBoss={onAskBoss} />
          <div className="flex items-stretch justify-between gap-6 border-b border-line px-8 py-7">
            <button onClick={() => setSheet('holdings')} className="text-left">
              <div className="label">The book</div>
              <div className="mt-2.5"><Value book={liveBook} size="xl" /></div>
              <ConvictionBar conviction={conviction} />
            </button>
          </div>
          <div className="px-8 pt-3.5">{statusRow}</div>
          {err && <p className="px-8 pt-2 mono text-[11px] text-crit">{err}</p>}
          <div className="px-8 pt-4">
            <StatTiles book={liveBook} cash={cash} sleeve={diag?.sleeve} breaches={flags.length}
              names={liveRows.length} contribution={pf?.contribution?.weekly} />
          </div>
          <div className="px-8 pb-8 pt-6">
            <div className="mb-1 flex items-baseline justify-between">
              <div className="label">Holdings</div>
              <span className="mono text-[10px] text-faint">{liveRows.length} names · tap for the council's read</span>
            </div>
            <Holdings rows={liveRows} total={liveBook.value} stances={stances} onRun={openRow} />
          </div>
        </div>
        <aside className="w-[340px] shrink-0 space-y-6 overflow-y-auto border-l border-line px-5 py-6">
          <Allocation diag={diag} onRulebook={() => setSheet('rulebook')} />
          <Breaches flags={flags} onRulebook={() => setSheet('rulebook')} />
          <Pulse items={notifs.slice(0, 14)} onOpen={onOpenAlert} />
        </aside>
        {sheets}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Queue onRun={openRow} onAskBoss={onAskBoss} />
      <div className="px-6 pb-1 pt-4">{statusRow}</div>
      <button onClick={() => setSheet('holdings')} className="block w-full px-6 pb-3 pt-1 text-left">
        <div className="label">The book</div>
        <div className="mt-1.5"><Value book={liveBook} /></div>
        <ConvictionBar conviction={conviction} />
      </button>
      {err && <p className="px-6 mono text-[11px] text-crit">{err}</p>}
      <div className="px-6 pb-4">
        <StatTiles book={liveBook} cash={cash} sleeve={diag?.sleeve} breaches={flags.length}
          names={liveRows.length} contribution={pf?.contribution?.weekly} />
        <div className="mb-1 mt-6 flex items-baseline justify-between">
          <div className="label">Holdings</div>
          <span className="mono text-[10px] text-faint">{liveRows.length} names</span>
        </div>
        <Holdings rows={liveRows} total={liveBook.value} stances={stances} onRun={openRow} dense />
        <div className="mt-6"><Allocation diag={diag} onRulebook={() => setSheet('rulebook')} /></div>
        <div className="mt-6"><Breaches flags={flags} onRulebook={() => setSheet('rulebook')} /></div>
        <div className="mt-6"><Pulse items={notifs.slice(0, 4)} onOpen={onOpenAlert} /></div>
      </div>
      {sheets}
    </div>
  );
}
