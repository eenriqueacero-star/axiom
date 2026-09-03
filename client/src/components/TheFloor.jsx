import { useEffect, useRef, useState } from 'react';
import { getFloor, getDca, getDeskWork, getPlaybooks, runDeskNight, getDeskEvents, getVault, getOpportunities } from '../api';
import { stanceStyle, verdictStyle, tierStyle, stripMd } from './stance';
import { AgentPanel, AgentChat, rel } from './floor/shared';

const AGENT_NAME = { quality: 'SAGE', trend: 'REX', catalyst: 'NOVA', bear: 'VEGA', sector: 'ATLAS', sizing: 'ZEN' };

/** Last night's desk run — the boss's brief + what each analyst was told to dig into. */
function LastNight() {
  const [work, setWork] = useState(undefined);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(null);
  const poll = useRef(null);

  const load = () => getDeskWork().then((r) => setWork(r.work || null)).catch(() => setWork(null));
  useEffect(() => { load(); return () => clearInterval(poll.current); }, []);

  const trigger = async () => {
    setRunning(true);
    try { await runDeskNight(); } catch { setRunning(false); return; }
    const started = Date.now();
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      const w = await getDeskWork().then((r) => r.work).catch(() => null);
      if (w) setWork(w);
      const settled = w && (w.status === 'done' || w.status === 'failed');
      if (settled || Date.now() - started > 6 * 60 * 1000) { clearInterval(poll.current); setRunning(false); }
    }, 12000);
  };

  if (work === undefined) return null;

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] uppercase tracking-[0.2em] text-haze">Last night at the desk</p>
        <button onClick={trigger} disabled={running}
          className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300 disabled:text-haze">
          {running ? 'Working…' : 'Convene tonight'}
        </button>
      </div>

      {!work ? (
        <p className="text-[11px] text-haze">
          The desk runs overnight (2 AM ET): the boss assigns each analyst research, they work it, and the findings
          become desk notes the council carries forward. Hit “Convene tonight” to run it now.
        </p>
      ) : work.status && work.status !== 'done' ? (
        <p className={`text-[11px] ${work.status === 'failed' ? 'text-[#f0685f]' : 'text-haze animate-pulse'}`}>
          {work.status === 'failed'
            ? `The desk hit a snag: ${work.error || 'unknown error'}`
            : `The desk is ${work.status}…${(work.findings || []).length ? ` ${work.findings.length}/6 analysts back` : ''}`}
        </p>
      ) : (
        <>
          <p className="text-[11px] text-ink-600">{work.date}{work.focus ? ` · focus: ${work.focus}` : ''}</p>
          {work.brief && <p className="text-sm text-neutral-200 leading-relaxed">{stripMd(work.brief)}</p>}
          <ul className="divide-y divide-ink-800/70">
            {(work.findings || []).map((f, i) => (
              <li key={i} className="py-2">
                <button onClick={() => setOpen(open === i ? null : i)} className="w-full text-left">
                  <span className="font-mono text-[11px] text-neutral-300">{f.agentName}</span>
                  <span className="text-[11px] text-haze"> — {f.task}</span>
                </button>
                {open === i && (
                  <div className="mt-1.5 text-[11px] text-neutral-400 leading-snug space-y-1">
                    <p>{stripMd(f.findings)}</p>
                    {f.sources?.length > 0 && (
                      <p className="text-ink-600">sources: {f.sources.join(' · ')}</p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {work.reflection && (
            <div className="border-t hairline pt-2 text-[11px] leading-snug">
              <p className="text-neutral-300">
                <span className="font-mono">{work.reflection.agentName}</span> sharpened their playbook
                <span className="text-ink-600"> → v{work.reflection.version}</span>
              </p>
              {work.reflection.research && <p className="text-neutral-400 mt-0.5">Found: {stripMd(work.reflection.research)}</p>}
              {work.reflection.bossFeedback && (
                <p className="text-haze mt-0.5">AXIOM: {stripMd(work.reflection.bossFeedback)}</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The event desk — real-world events the boss triaged: acted on, or set aside. */
function EventDesk({ onAnalyze }) {
  const [events, setEvents] = useState(undefined);
  const [vault, setVault] = useState([]);
  const [open, setOpen] = useState(null);
  const [showVault, setShowVault] = useState(false);

  useEffect(() => {
    getDeskEvents().then((r) => setEvents(r.events || [])).catch(() => setEvents([]));
    getVault().then((r) => setVault(r.vault || [])).catch(() => {});
  }, []);

  if (events === undefined) return null;
  if (!events.length && !vault.length) return null;

  return (
    <div className="card p-4 space-y-3">
      <p className="text-[10px] uppercase tracking-[0.2em] text-haze">The event desk</p>

      {events.length > 0 ? (
        <ul className="divide-y divide-ink-800/70">
          {events.map((e, i) => (
            <li key={e.id || i} className="py-2">
              <button onClick={() => setOpen(open === i ? null : i)} className="w-full text-left">
                <div className="flex items-center gap-2">
                  {e.ticker && (
                    <button onClick={(ev) => { ev.stopPropagation(); onAnalyze(e.ticker); }}
                      className="font-mono text-[11px] text-neutral-200 hover:text-indigo-400">{e.ticker}</button>
                  )}
                  <span className="text-[11px] text-haze truncate flex-1">{stripMd(e.event || '')}</span>
                  {e.status && e.status !== 'done' && (
                    <span className={`text-[10px] font-mono shrink-0 ${e.status === 'failed' ? 'text-[#f0685f]' : 'text-haze animate-pulse'}`}>{e.status}</span>
                  )}
                </div>
              </button>
              {open === i && (
                <div className="mt-1.5 text-[11px] text-neutral-400 leading-snug space-y-1.5">
                  {e.brief && <p className="text-neutral-300">{stripMd(e.brief)}</p>}
                  {(e.findings || []).map((f, j) => (
                    <p key={j}><span className="font-mono text-neutral-300">{f.agentName}</span>
                      <span className="text-ink-600"> — {f.task}</span><br />{stripMd(f.findings)}</p>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-haze">Nothing has needed the desk's attention lately.</p>
      )}

      {vault.length > 0 && (
        <div className="border-t hairline pt-2">
          <button onClick={() => setShowVault(!showVault)} className="text-[11px] text-haze hover:text-neutral-300">
            {showVault ? '▾' : '▸'} the vault — {vault.length} set aside
          </button>
          {showVault && (
            <ul className="mt-1.5 space-y-1">
              {vault.slice(0, 20).map((v, i) => (
                <li key={v.id || i} className="text-[11px] text-ink-500 leading-snug">
                  {v.ticker && <span className="font-mono text-neutral-400">{v.ticker} </span>}
                  {stripMd(v.headline || '')}
                  {v.bossNote && <span className="text-ink-600"> — {v.bossNote}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Scout's best calls on names you don't own — the daily discovery sweep, ranked. */
function DiscoveryCard({ items, onAnalyze }) {
  if (!items?.length) return null;
  return (
    <div className="card p-4">
      <p className="text-[11px] uppercase tracking-widest text-haze mb-2">Worth a look — scout picks you don’t own</p>
      <ul className="space-y-1">
        {items.map((r) => {
          const v = verdictStyle(r.verdict);
          const t = tierStyle(r.tier);
          return (
            <li key={r.ticker}>
              <button onClick={() => onAnalyze(r.ticker)} className="w-full flex items-center gap-2 text-left py-1 hover:bg-ink-850 rounded px-1">
                <span className="font-mono text-sm text-neutral-200 w-14">{r.ticker}</span>
                <span className="text-xs font-semibold shrink-0" style={{ color: v.fg }}>{r.verdict} {r.conviction}/10</span>
                {t && <span className="font-mono text-[10px] tracking-wider shrink-0" style={{ color: t.fg }}>{t.label}</span>}
                <span className="text-[11px] text-haze truncate flex-1">{stripMd(r.headline)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OpportunitiesCard({ onAnalyze }) {
  const [opps, setOpps] = useState(null);
  useEffect(() => { getOpportunities().then((r) => setOpps(r.opportunities || [])).catch(() => setOpps([])); }, []);
  if (!opps?.length) return null;

  const CALL = {
    buy_new: { label: 'BUY', fg: '#4ade80' },
    act_held: { label: 'ACT', fg: '#fbbf24' },
    watch: { label: 'WATCH', fg: '#8b9cff' },
  };
  return (
    <div className="card p-4">
      <p className="text-[11px] uppercase tracking-widest text-haze mb-2">The boss sees an angle — from the inbox</p>
      <ul className="space-y-1">
        {opps.map((o) => {
          const c = CALL[o.call] || CALL.watch;
          return (
            <li key={o.id}>
              <button onClick={() => onAnalyze(o.ticker)} className="w-full flex items-center gap-2 text-left py-1 hover:bg-ink-850 rounded px-1">
                <span className="font-mono text-sm text-neutral-200 w-14">{o.ticker}</span>
                <span className="text-xs font-semibold shrink-0" style={{ color: c.fg }}>{c.label}{o.conviction ? ` ${o.conviction}/10` : ''}</span>
                {o.held && <span className="text-[9px] font-mono text-haze shrink-0">HELD</span>}
                <span className="text-[11px] text-haze truncate flex-1">{o.note}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DcaCard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { getDca().then(setD).catch((e) => setErr(e.message)); }, []);
  if (err || !d) return null;

  return (
    <div className="card p-4">
      <p className="text-[11px] uppercase tracking-widest text-haze mb-2">This cycle's contribution</p>
      {d.contribution?.amount > 0 && (
        <p className="text-xs text-neutral-300 mb-1">
          ${d.contribution.amount}{d.contribution.kind === 'weekly' ? '/week' : d.contribution.date ? ` on ${d.contribution.date}` : ''}
          {d.contribution.projected30d != null && <span className="text-haze"> · ~${d.contribution.projected30d} over 30d</span>}
        </p>
      )}
      {!d.ready ? (
        <p className="text-xs text-haze">{d.note}</p>
      ) : d.pick ? (
        <>
          <p className="text-sm text-neutral-100">
            → <span className="font-mono text-emerald-400">{d.pick.ticker}</span>
            <span className="text-haze"> · {d.pick.sector}</span>
          </p>
          <p className="text-xs text-neutral-400 mt-1">{d.pick.reason}</p>
        </>
      ) : (
        <>
          <p className="text-sm text-neutral-100">→ <span className="font-mono text-amber-400">{d.buffer.etf}</span> (buffer)</p>
          <p className="text-xs text-neutral-400 mt-1">{d.buffer.reason}</p>
        </>
      )}
      {d.ready && d.ranked?.length > 0 && (
        <div className="mt-3 space-y-1">
          {d.ranked.slice(0, 5).map((r) => (
            <div key={r.ticker} className="flex items-center gap-2 text-[11px]">
              <span className="font-mono w-14 text-neutral-300">{r.ticker}</span>
              <span className={r.entryOk === true ? 'text-emerald-400' : r.entryOk === false ? 'text-red-400' : 'text-ink-600'}>
                {r.entryOk === true ? '✓' : r.entryOk === false ? '✗' : '–'}
              </span>
              <span className="text-haze flex-1 truncate">{r.entryWhy}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Room({ agent, data, weight, calibration, playbook, onAnalyze }) {
  const [open, setOpen] = useState(false);
  const last = data?.recent?.[0];
  const s = last ? stanceStyle(last.stance) : null;

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full p-4 text-left">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-base">{agent.emoji}</span>
            <span className="font-mono text-xs tracking-wider" style={{ color: agent.color }}>{agent.name}</span>
          </div>
          {s && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ color: s.fg, background: s.bg }}>
              {s.label}
            </span>
          )}
        </div>
        <p className="text-[11px] uppercase tracking-wide text-haze">{agent.role}</p>
        <p className="text-[11px] text-ink-500 mt-1">
          {data?.calls || 0} calls
          {last ? ` · last: ${last.ticker} ${rel(last.ts)}` : ''}
        </p>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t hairline pt-3">
          <AgentPanel agent={agent} data={data} weight={weight} calibration={calibration} playbook={playbook} onAnalyze={onAnalyze} />
          <AgentChat agent={agent} />
        </div>
      )}
    </div>
  );
}

export default function TheFloor({ onAnalyze }) {
  const [floor, setFloor] = useState(null);
  const [playbooks, setPlaybooks] = useState({});
  const [err, setErr] = useState('');

  useEffect(() => {
    getFloor().then(setFloor).catch((e) => setErr(e.message));
    getPlaybooks().then((r) => setPlaybooks(r.playbooks || {})).catch(() => {});
  }, []);

  if (err) return <p className="text-xs text-red-400">{err}</p>;
  if (!floor) return <p className="text-xs text-haze animate-pulse">Loading the floor…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-sm text-neutral-200">The Floor</h1>
        <p className="text-[11px] text-haze">
          Six analysts. Each answers a fixed set of yes/no checks; the verdict is computed from them against the rulebook.
          {floor.scored > 0 ? ` ${floor.scored} past calls scored.` : ' No calls scored yet — track records fill in after ~1 week.'}
        </p>
      </div>

      <LastNight />
      <EventDesk onAnalyze={onAnalyze} />
      <OpportunitiesCard onAnalyze={onAnalyze} />
      <DcaCard />
      <DiscoveryCard items={floor.discovery} onAnalyze={onAnalyze} />

      <div className="grid gap-3 sm:grid-cols-2">
        {floor.agents.map((a) => (
          <Room key={a.id} agent={a} data={floor.perAgent[a.id]} weight={floor.weights?.[a.id]}
            calibration={floor.calibration?.[a.id]} playbook={playbooks[a.id]} onAnalyze={onAnalyze} />
        ))}
      </div>

      <div className="card p-4">
        <p className="text-[11px] uppercase tracking-widest text-haze mb-2">Scheduled work</p>
        <ul className="space-y-2">
          {floor.schedule.map((j) => (
            <li key={j.job} className="text-xs">
              <span className="text-neutral-200">{j.job}</span>
              <span className="text-ink-500"> · {j.cadence}</span>
              <p className="text-[11px] text-haze">{j.does}</p>
            </li>
          ))}
        </ul>
      </div>

      {floor.recentRuns.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-widest text-haze mb-2">Council activity</p>
          <ul className="divide-y divide-ink-800 card overflow-hidden">
            {floor.recentRuns.map((r) => {
              const v = verdictStyle(r.verdict);
              return (
                <li key={r.id}>
                  <button onClick={() => onAnalyze(r.ticker)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-ink-850 text-left">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-sm text-neutral-200">{r.ticker}</span>
                      <span className="text-[11px] text-haze truncate">{stripMd(r.headline)}</span>
                    </div>
                    <span className="text-xs font-semibold shrink-0 ml-2" style={{ color: v.fg }}>
                      {r.verdict} · {r.conviction}/10
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
