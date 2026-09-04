import { useEffect, useMemo, useState } from 'react';
import { getDeskState, getDeskWork, getOpportunities, getDeskEvents, getMacro, getFloor, getFloorLive, convene, getStrategyDiagnostics } from '../api';
import Icon, { AGENT_META, AGENT_IDS } from '../ui/Icon';
import Core from '../floor/Core';
import Sheet from '../ui/Sheet';
import JobsPanel from '../ui/JobsPanel';
import NewsPanel from '../ui/NewsPanel';
import { getJobs } from '../api';
import { AgentSheet } from './sheets/AgentSheet';

function ScheduleCard({ onOpen }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => getJobs().then((r) => alive && setData(r)).catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const jobs = data?.jobs || [];
  const failing = data?.failing?.length || jobs.filter((j) => j.status === 'failing').length;
  const overdue = data?.overdue?.length || jobs.filter((j) => j.status === 'overdue').length;
  const line = !data
    ? 'loading…'
    : failing || overdue
      ? [overdue && `${overdue} overdue`, failing && `${failing} failing`].filter(Boolean).join(', ')
      : `${jobs.length} jobs · all running`;
  return (
    <button onClick={onOpen}
      className="press panel rise-in w-full rounded-xl p-4 text-left"
      style={{ borderLeft: '2px solid var(--accent)', boxShadow: '0 0 24px -12px var(--accent-glow)' }}>
      <div className="flex items-center gap-2">
        <Icon name="sync" size={13} className="text-accent" />
        <h3 className="label !tracking-[0.16em]">The desk's schedule</h3>
        <Icon name="chevron" size={13} className="ml-auto text-faint" />
      </div>
      <p className={`mono text-2xs mt-2 ${failing ? 'text-crit' : overdue ? 'text-warn' : 'text-muted'}`}>{line}</p>
      <p className="mt-1 text-[11px] text-faint">Tap to view and tune what the desk runs.</p>
    </button>
  );
}

function rel(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function Panel({ title, icon, children, action }) {
  return (
    <section className="panel rounded-xl p-4 rise-in">
      <div className="mb-3 flex items-center gap-2">
        {icon && <Icon name={icon} size={13} className="text-muted" />}
        <h3 className="label !tracking-[0.16em]">{title}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function Convene({ onDone }) {
  const [state, setState] = useState('idle'); // idle | running | ok | skip
  const [msg, setMsg] = useState('');
  const go = async () => {
    setState('running'); setMsg('');
    try {
      const r = await convene();
      if (r?.ok) { setState('ok'); setMsg(r.pairing ? `${r.pairing.a} & ${r.pairing.b} sat down` : 'The desk convened'); onDone?.(); }
      else { setState('skip'); setMsg(r?.skipped || 'Nothing worth talking about right now'); }
    } catch (e) {
      setState('skip'); setMsg(e.message);
    }
    setTimeout(() => { setState('idle'); setMsg(''); }, 6000);
  };
  return (
    <div className="flex items-center gap-3">
      <button onClick={go} disabled={state === 'running'}
        className="btn-accent h-8 px-3.5 disabled:opacity-50">
        {state === 'running' ? 'convening…' : 'convene the desk'}
      </button>
      {msg && <span className={`mono text-[10px] ${state === 'ok' ? 'text-good' : 'text-faint'}`}>{msg}</span>}
    </div>
  );
}

export default function Floor({ desktop, onRun }) {
  const [work, setWork] = useState(null);
  const [state, setState] = useState(null);
  const [opps, setOpps] = useState([]);
  const [events, setEvents] = useState([]);
  const [macro, setMacro] = useState([]);
  const [floor, setFloor] = useState(null);
  const [live, setLive] = useState(null);
  const [diag, setDiag] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [jobsOpen, setJobsOpen] = useState(false);

  const load = () => {
    getDeskState().then((r) => setState(r)).catch(() => {});
    getOpportunities().then((r) => setOpps(r.opportunities || [])).catch(() => {});
  };

  useEffect(() => {
    let alive = true;
    Promise.all([
      getDeskWork().catch(() => null),
      getDeskEvents().catch(() => ({ events: [] })),
      getMacro().catch(() => ({ events: [] })),
      getFloor().catch(() => null),
      getStrategyDiagnostics().catch(() => null),
    ]).then(([w, e, m, f, d]) => {
      if (!alive) return;
      setWork(w?.work || null);
      setEvents(e?.events || []);
      setMacro(m?.events || []);
      setFloor(f); setDiag(d);
    });
    load();
    const poll = () => getFloorLive().then((l) => alive && setLive(l)).catch(() => {});
    poll();
    const id = setInterval(() => { poll(); load(); }, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // agents on the floor show their REAL assigned task (from the nightly desk run)
  const agents = useMemo(() => {
    const byId = {};
    (work?.assignments || []).forEach((a) => { byId[a.agentId] = a.task; });
    const dialoguePair = state?.activeDialogue ? [state.activeDialogue.a, state.activeDialogue.b] : [];
    return AGENT_IDS.map((id) => {
      const task = byId[id];
      const inDialogue = dialoguePair.includes(id);
      return {
        id,
        work: (task || inDialogue) ? {
          task: inDialogue ? `At the table with ${AGENT_META[dialoguePair.find((x) => x !== id)]?.name || 'a colleague'}` : task,
          startedMs: work?.startedAt || Date.now() - 120000,
          pct: work?.findings?.some?.((f) => f.agentId === id) ? 100 : 55,
        } : null,
      };
    });
  }, [work, state]);

  const sectors = diag?.sectors?.map((s) => ({ name: s.name, pct: s.pct })) || [];
  const breaches = diag?.flags?.length || 0;
  const notes = state?.notes || [];

  const deskPanels = (
    <>
      <ScheduleCard onOpen={() => setJobsOpen(true)} />

      <Panel title="On the wire" icon="news">
        <NewsPanel compact />
      </Panel>

      <Panel title="Convene" icon="chat">
        <p className="mb-3 text-[11px] leading-relaxed text-muted">
          Two analysts with a real disagreement sit down and talk it out. The result becomes a desk note the whole council reads back.
        </p>
        <Convene onDone={load} />
      </Panel>

      {work && (
        <Panel title="Last night at the desk" icon="desk">
          {work.brief
            ? <p className="text-[12px] leading-relaxed text-text">{work.brief}</p>
            : work.error
              ? <p className="text-[11px] text-warn">The run stalled: {work.error}</p>
              : <p className="text-[11px] text-faint">Assignments went out; findings pending.</p>}
          {work.assignments?.length > 0 && (
            <ul className="mt-3 space-y-2">
              {work.assignments.map((a) => (
                <li key={a.agentId} className="text-[11px] leading-snug">
                  <span className="mono text-[10px]" style={{ color: AGENT_META[a.agentId]?.color }}>{AGENT_META[a.agentId]?.name || a.agentId}</span>
                  <span className="text-muted"> — {a.task}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {opps.length > 0 && (
        <Panel title="The boss sees an angle" icon="opportunity">
          <ul className="space-y-2">
            {opps.map((o) => (
              <li key={o.id}>
                <button onClick={() => onRun?.(o.ticker)} className="press flex w-full items-center gap-2 rounded-md px-1 py-1 text-left">
                  <span className="mono w-14 text-[12px] text-text">{o.ticker}</span>
                  <span className="mono text-[10px]" style={{ color: o.call === 'buy_new' ? 'var(--good)' : o.call === 'watch' ? 'var(--accent)' : 'var(--warn)' }}>
                    {o.call === 'buy_new' ? 'BUY' : o.call === 'watch' ? 'WATCH' : 'ACT'}{o.conviction ? ` ${o.conviction}/10` : ''}
                  </span>
                  {o.held && <span className="mono text-[8px] text-faint">HELD</span>}
                  <span className="flex-1 truncate text-[11px] text-muted">{o.note}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={`Desk notes${notes.length ? ` · ${notes.length}` : ''}`} icon="desk">
        {notes.length === 0 ? (
          <p className="text-[11px] text-faint">Nothing settled yet. The council talks on its own when you're away, or hit convene.</p>
        ) : (
          <ul className="space-y-2.5">
            {notes.slice(0, 8).map((n) => (
              <li key={n.id} className="text-[11.5px] leading-snug">
                <div className="flex items-baseline gap-2">
                  <span className="mono text-[9px] text-faint">{(n.participants || []).map((p) => AGENT_META[p]?.name || p.toUpperCase()).join(' · ')}</span>
                  {n.ticker && <span className="mono text-[9px] text-muted">{n.ticker}</span>}
                  <span className="mono ml-auto text-[9px] text-faint">{rel(n.ts)}</span>
                </div>
                <p className="mt-0.5 text-muted">{n.conclusion}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {events.length > 0 && (
        <Panel title="Event desk" icon="spark">
          <ul className="space-y-2">
            {events.slice(0, 6).map((e, i) => (
              <li key={i} className="text-[11px] leading-snug">
                {e.ticker && <button onClick={() => onRun?.(e.ticker)} className="mono text-[10px] text-accent">{e.ticker} </button>}
                <span className="text-muted">{e.event || e.headline || e.brief}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {macro.length > 0 && (
        <Panel title="Macro calendar" icon="macro">
          <ul className="space-y-1.5">
            {macro.slice(0, 5).map((e) => (
              <li key={`${e.date}${e.event}`} className="flex items-center gap-2 text-[11px]">
                <span className="mono w-12 shrink-0 text-faint">{String(e.date).slice(5)}</span>
                <span className="w-8 shrink-0 text-faint">{e.daysOut === 0 ? 'today' : `${e.daysOut}d`}</span>
                <span className="truncate text-muted">{e.event}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );

  const core = (
    <Core agents={agents} sectors={sectors} breaches={breaches} dayPct={diag ? 0 : 0}
      onAgent={(id) => setSheet(id)} onCore={() => {}} />
  );

  const sheets = (
    <>
      <Sheet open={!!sheet} onClose={() => setSheet(null)} labelledBy="sheet-agent-title">
        {sheet && <AgentSheet id={sheet} live={live?.agents?.[sheet]} floor={floor}
          onAnalyze={(t) => { setSheet(null); onRun?.(t); }} />}
      </Sheet>
      <Sheet open={jobsOpen} onClose={() => setJobsOpen(false)} labelledBy="sheet-jobs-title">
        <h2 id="sheet-jobs-title" className="sr-only">The desk's schedule</h2>
        {jobsOpen && <JobsPanel />}
      </Sheet>
    </>
  );

  if (desktop) {
    return (
      <div className="flex h-full">
        <div className="relative min-w-0 flex-1">{core}</div>
        <aside className="w-[360px] shrink-0 space-y-3 overflow-y-auto border-l border-line p-4">
          <div className="label !text-[11px] !tracking-[0.2em] text-text">The Floor</div>
          {deskPanels}
        </aside>
        {sheets}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="relative h-[46%] shrink-0">{core}</div>
      <div className="flex-1 space-y-3 overflow-y-auto border-t border-line p-4">
        {deskPanels}
      </div>
      {sheets}
    </div>
  );
}
