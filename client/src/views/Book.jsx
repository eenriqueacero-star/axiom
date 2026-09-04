import { useEffect, useMemo, useState } from 'react';
import { getPortfolio, getStrategyDiagnostics, getFloor, getFloorLive, getStances } from '../api';
import { useNotifications } from '../hooks/useNotifications';
import Icon, { AGENT_META, AGENT_IDS } from '../ui/Icon';
import Core from '../floor/Core';
import Sheet from '../ui/Sheet';
import { AgentSheet } from './sheets/AgentSheet';
import { HoldingsSheet } from './sheets/HoldingsSheet';
import { RulebookSheet } from './sheets/RulebookSheet';

const money = (n) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`);
const signed = (n) => `${n >= 0 ? '+' : '−'}$${Math.abs(Math.round(n)).toLocaleString()}`;
const pct1 = (x) => (x == null ? '' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);

/* a job running now → a plain-language task for that agent, until the backend
   tracks real per-agent tasks (the GAP in the inventory). */
const JOB_TASK = {
  scout:     'Re-rating every holding',
  alerts:    'Watching for big moves',
  scorecard: 'Scoring past calls',
  scan:      'Scanning for news & filings',
  congress:  'Checking congressional trades',
  'boss-sweep': 'Reviewing the inbox for an angle',
};
const AGENT_JOB = { catalyst: 'scan', trend: 'alerts', quality: 'scorecard', bear: 'scan', sector: 'scout', sizing: 'scorecard' };

function relTime(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const KIND_ICON = {
  news: 'news', filing: 'filing', insider: 'insider', congress: 'congress',
  move: 'move', rating: 'rating', scout: 'scout', desk: 'desk',
  opportunity: 'opportunity', macro: 'macro',
};

export default function Book({ onOpenAgent, onOpenAlert }) {
  const [pf, setPf] = useState(null);
  const [diag, setDiag] = useState(null);
  const [floor, setFloor] = useState(null);
  const [live, setLive] = useState(null);
  const [stances, setStances] = useState(null);
  const [err, setErr] = useState('');
  const [sheet, setSheet] = useState(null);   // 'agent:<id>' | 'holdings' | 'rulebook' | null
  const { items: notifs } = useNotifications(20);

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
      if (!p && !d) setErr('Could not reach the desk. Pull to retry.');
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
      allTime: t.gain ?? null,
      allTimePct: t.gainPct ?? null,
    };
  }, [pf, diag]);

  const conviction = useMemo(() => {
    // stances.counts gives per-tier $ or count; fall back to diag sleeve
    const c = stances?.buckets || stances?.counts || null;
    if (c && (c.HIGH != null || c.high != null)) {
      const g = (k) => c[k] ?? c[k?.toLowerCase?.()] ?? 0;
      const tot = g('HIGH') + g('MED') + g('LOW') + g('SPEC') || 1;
      return { high: g('HIGH') / tot, med: g('MED') / tot, low: g('LOW') / tot, spec: g('SPEC') / tot, tot };
    }
    return null;
  }, [stances]);

  const sectors = diag?.sectors?.map((s) => ({ name: s.name, pct: s.pct })) || [];
  const breaches = diag?.flags?.length || 0;

  const agents = useMemo(() => AGENT_IDS.map((id) => {
    const la = live?.agents?.[id];
    const jobKey = AGENT_JOB[id];
    const busy = !!(la?.busy) || !!(live?.busy?.[jobKey]);
    return {
      id,
      work: busy ? {
        task: JOB_TASK[jobKey] || 'Working',
        startedMs: Date.now() - 60000,   // GAP: real start time not tracked yet
        pct: 45,                          // GAP: real progress not tracked yet
      } : null,
      reaction: la?.reaction,
      metric: la?.metric,
    };
  }), [live]);

  const alertLine = useMemo(() => {
    const parts = [];
    if (breaches) parts.push(`${breaches} rule breach${breaches > 1 ? 'es' : ''}`);
    const hot = diag?.sectors?.find((s) => s.pct > 0.35);
    if (hot) parts.push(`${hot.name.toLowerCase()} ${Math.round(hot.pct * 100)}% of the book`);
    return parts.join(' · ');
  }, [diag, breaches]);

  const workingCount = agents.filter((a) => a.work).length;

  return (
    <div className="flex h-full flex-col">
      {/* status */}
      <div className="flex items-center justify-between px-6 pt-5 pb-3 mono text-[10px] tracking-[0.12em] text-faint">
        <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toUpperCase()} ET</span>
        <span className="flex items-center gap-1.5 text-muted">
          <i className="h-1.5 w-1.5 rounded-full bg-good shadow-[0_0_8px_var(--zen)]" />
          {workingCount ? `${workingCount} working` : 'desk quiet'}
        </span>
      </div>

      {/* the book — the lit headline */}
      <button onClick={() => setSheet('holdings')} className="px-6 pb-3 text-left">
        <div className="label">The book</div>
        <div className="mt-1.5 flex items-baseline gap-3">
          <span className="font-wide text-[40px] font-bold leading-none tracking-tight text-lit tabular-nums">
            {book.value == null ? '—' : `$${book.value.toLocaleString()}`}
          </span>
          {book.dayChange != null && (
            <span className={`mono text-xs flex items-center gap-1 ${book.dayChange >= 0 ? 'text-good' : 'text-crit'}`}>
              <Icon name="up" size={9} className={book.dayChange >= 0 ? '' : 'rotate-180'} />
              {signed(book.dayChange)} today
            </span>
          )}
        </div>

        {conviction ? (
          <>
            <div className="mt-3 flex h-[3px] gap-[1.5px] overflow-hidden rounded-sm">
              <span className="bg-good" style={{ width: `${conviction.high * 100}%` }} />
              <span style={{ width: `${conviction.med * 100}%`, background: '#5a6b8c' }} />
              <span className="bg-warn" style={{ width: `${conviction.low * 100}%` }} />
              <span className="bg-crit" style={{ width: `${conviction.spec * 100}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between mono text-[9px] tracking-[0.08em] text-faint">
              <span>HIGH {Math.round(conviction.high * 100)}</span>
              <span>MED {Math.round(conviction.med * 100)}</span>
              <span>LOW {Math.round(conviction.low * 100)}</span>
              <span>SPEC {Math.round(conviction.spec * 100)}</span>
            </div>
          </>
        ) : (
          <div className="mt-3 mono text-[10px] text-faint">council read loading…</div>
        )}

        {alertLine && (
          <div className="mt-2.5 flex items-center gap-1.5 mono text-[10px] tracking-[0.03em] text-warn">
            <Icon name="warn" size={11} /> {alertLine}
          </div>
        )}
      </button>

      {err && <p className="px-6 mono text-[11px] text-crit">{err}</p>}

      {/* the living floor */}
      <Core
        agents={agents}
        sectors={sectors}
        breaches={breaches}
        dayPct={book.dayPct}
        onAgent={(id) => setSheet(`agent:${id}`)}
        onCore={() => setSheet('rulebook')}
      />

      {/* pulse — one stream */}
      <div className="border-t border-line px-5 pt-2.5 pb-2">
        <button onClick={onOpenAlert} className="label mb-1.5 flex items-center gap-1.5">
          <i className="h-1 w-1 rounded-full bg-muted" /> Pulse
        </button>
        <div className="flex flex-col gap-1.5">
          {notifs.slice(0, 3).map((n) => (
            <button key={n.id} onClick={onOpenAlert}
              className="grid grid-cols-[13px_1fr_auto] items-center gap-2.5 text-left text-xs text-text">
              <Icon name={KIND_ICON[n.kind] || 'desk'} size={13} className="text-muted" />
              <span className="truncate">{n.title}</span>
              <time className="mono text-[10px] text-faint">{relTime(n.ts)}</time>
            </button>
          ))}
          {notifs.length === 0 && (
            <p className="text-[11px] text-faint">Nothing on the wire. News, filings and the boss's reads land here.</p>
          )}
        </div>
      </div>

      {/* sheets */}
      <Sheet open={sheet?.startsWith('agent:')} onClose={() => setSheet(null)} labelledBy="sheet-agent-title">
        {sheet?.startsWith('agent:') && (
          <AgentSheet
            id={sheet.slice(6)}
            live={live?.agents?.[sheet.slice(6)]}
            floor={floor}
            onAnalyze={(t) => { setSheet(null); onOpenAgent?.(t); }}
          />
        )}
      </Sheet>

      <Sheet open={sheet === 'holdings'} onClose={() => setSheet(null)} labelledBy="sheet-holdings-title">
        {sheet === 'holdings' && (
          <HoldingsSheet pf={pf} diag={diag} stances={stances} onAnalyze={(t) => { setSheet(null); onOpenAgent?.(t); }} />
        )}
      </Sheet>

      <Sheet open={sheet === 'rulebook'} onClose={() => setSheet(null)} labelledBy="sheet-rulebook-title">
        {sheet === 'rulebook' && <RulebookSheet diag={diag} />}
      </Sheet>
    </div>
  );
}
