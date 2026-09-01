import { useEffect, useMemo, useRef, useState } from 'react';
import { getFloor, getDeskState, convene } from '../api';
import { AgentPanel, AgentChat } from './floor/shared';

/**
 * The Floor, in plan view.
 *
 * A schematic of the council rather than a picture of a room — thin strokes,
 * mono labels, one accent colour per analyst. Everything that moves is bound to
 * real state: an analyst slides to the table only when it is genuinely in the
 * running dialogue, the link between two of them lights only while they are
 * talking, and each status line is that agent's own read on the book.
 */

const W = 1000;
const H = 640;
const CX = W / 2;
const CY = H / 2;
const DESK_R = 232;   // ring the desks sit on
const SEAT_R = 104;   // where they stand when called in
const TABLE_R = 66;

const TURN_MS = 4200;
const WALK_MS = 2200;

const pt = (i, r) => {
  const a = -Math.PI / 2 + (i * Math.PI * 2) / 6;
  return { x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r };
};

function statusFor(id, live, act, shownTurns) {
  if (act && (act.a === id || act.b === id)) {
    const other = act.a === id ? act.bName : act.aName;
    if (act.phase === 'writing') return { icon: '✍️', text: 'writing the note up' };
    const last = shownTurns > 0 ? act.turns?.[shownTurns - 1] : null;
    if (last && last.agent === id) return { icon: '🗣️', text: `making the case to ${other}` };
    return { icon: '👂', text: `hearing ${other} out` };
  }
  const a = live?.agents?.[id];
  if (a?.busy) return { icon: '📊', text: 'running its checks' };
  const m = a?.metric || {};
  switch (id) {
    case 'trend':
      if (m.trendScore > 0.3) return { icon: '📈', text: 'holdings above their 200-day' };
      if (m.trendScore < -0.3) return { icon: '📉', text: `${m.downtrending?.length || 0} in a downtrend` };
      return { icon: '📐', text: 'trend is mixed' };
    case 'bear':
      if (m.high) return { icon: '🚨', text: `${m.high} serious flag${m.high > 1 ? 's' : ''}` };
      if (m.flags) return { icon: '⚠️', text: `${m.flags} rulebook flag${m.flags > 1 ? 's' : ''}` };
      return { icon: '🔍', text: 'nothing broken' };
    case 'catalyst':
      if (m.freshNews) return { icon: '📰', text: `news on ${m.tickers?.slice(0, 2).join(', ') || `${m.freshNews} names`}` };
      return { icon: '📭', text: 'no new catalysts' };
    case 'sector':
      if (m.hottest?.overCap) return { icon: '🌡️', text: `${m.hottest.name} ${Math.round(m.hottest.pct * 100)}% over cap` };
      return { icon: '🌐', text: 'sectors within cap' };
    case 'sizing':
      if (m.tilt != null && Math.abs(m.tilt) > 0.5) return { icon: '⚖️', text: `Core ${Math.round((m.corePct || 0) * 100)}% vs 50%` };
      return { icon: '⚖️', text: 'sleeves near target' };
    case 'quality':
      if (m.coreBroken?.length) return { icon: '🛡️', text: `watching ${m.coreBroken.join(', ')}` };
      return { icon: '🛡️', text: `${m.coreHeld || 0} Core names held` };
    default:
      return { icon: '·', text: 'at the desk' };
  }
}

/* ------------------------------------------------------------------ desk */
function Desk({ agent, index, selected, dim, status, onSelect }) {
  const p = pt(index, DESK_R);
  const w = 176, h = 62;
  const x = p.x - w / 2, y = p.y - h / 2;
  return (
    <g
      className="cursor-pointer"
      onClick={(e) => { e.stopPropagation(); onSelect(agent.id); }}
      style={{ opacity: dim ? 0.35 : 1, transition: 'opacity .4s' }}
    >
      <rect
        x={x} y={y} width={w} height={h} rx={8}
        fill="#101014"
        stroke={selected ? agent.color : '#26262e'}
        strokeWidth={selected ? 1.5 : 1}
      />
      <rect x={x} y={y} width={3} height={h} rx={1.5} fill={agent.color} />
      <text x={x + 14} y={y + 22} className="font-mono" fontSize="12.5" letterSpacing="1.4" fill="#e7e7ea">
        {agent.name}
      </text>
      <text x={x + 14} y={y + 38} fontSize="9.5" fill="#6f6f7c">{agent.role}</text>
      <text x={x + 14} y={y + 53} fontSize="10" fill="#9a9aa6">
        {status.icon} {status.text.length > 26 ? status.text.slice(0, 25) + '…' : status.text}
      </text>
    </g>
  );
}

/* ---------------------------------------------------------------- token */
// The analyst themselves. Slides between desk and table; nothing else moves it.
function Token({ agent, index, atTable, speaking }) {
  const home = pt(index, DESK_R - 52);
  const seat = pt(index, SEAT_R);
  const p = atTable ? seat : home;
  return (
    <g
      style={{
        transform: `translate(${p.x}px, ${p.y}px)`,
        transition: `transform ${WALK_MS}ms cubic-bezier(.4,0,.2,1)`,
      }}
    >
      {speaking && (
        <circle r={17} fill="none" stroke={agent.color} strokeWidth="1.5" opacity="0.9">
          <animate attributeName="r" values="11;22" dur="1.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.9;0" dur="1.4s" repeatCount="indefinite" />
        </circle>
      )}
      <circle r={11} fill="#0c0c10" stroke={agent.color} strokeWidth="2" />
      <circle r={4.5} fill={agent.color} />
    </g>
  );
}

/* ---------------------------------------------------------------- table */
function Table({ notes, active, selected, onSelect }) {
  return (
    <g className="cursor-pointer" onClick={(e) => { e.stopPropagation(); onSelect('table'); }}>
      <circle
        cx={CX} cy={CY} r={TABLE_R}
        fill="#0d0d12"
        stroke={active ? '#8ea2ff' : selected ? '#3d3d48' : '#22222a'}
        strokeWidth={active ? 1.6 : 1}
      >
        {active && <animate attributeName="stroke-opacity" values="1;0.35;1" dur="2s" repeatCount="indefinite" />}
      </circle>
      <text x={CX} y={CY - 8} textAnchor="middle" fontSize="9" letterSpacing="2" fill="#5b5b68">THE DESK</text>
      <text x={CX} y={CY + 10} textAnchor="middle" className="font-mono" fontSize="15" fill="#cfcfd6">
        {notes.length}
      </text>
      <text x={CX} y={CY + 24} textAnchor="middle" fontSize="8.5" fill="#5b5b68">
        {notes.length === 1 ? 'note' : 'notes'}
      </text>
      {/* one tick per note, gold when it's actionable */}
      {notes.slice(0, 14).map((n, i) => {
        const a = -Math.PI / 2 + (i / 14) * Math.PI * 2;
        const r1 = TABLE_R + 6, r2 = TABLE_R + 12;
        return (
          <line
            key={n.id || i}
            x1={CX + Math.cos(a) * r1} y1={CY + Math.sin(a) * r1}
            x2={CX + Math.cos(a) * r2} y2={CY + Math.sin(a) * r2}
            stroke={n.actionable ? '#facc15' : '#4a4a58'} strokeWidth="2" strokeLinecap="round"
          />
        );
      })}
    </g>
  );
}

/* --------------------------------------------------------------- export */
export default function TheOffice({ onAnalyze, onExit }) {
  const [floor, setFloor] = useState(null);
  const [desk, setDesk] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);
  const [convening, setConvening] = useState(false);
  const [now, setNow] = useState(Date.now());
  const act = desk?.activeDialogue || null;

  useEffect(() => {
    let alive = true;
    getFloor().then((f) => alive && setFloor(f)).catch((e) => alive && setErr(e.message));
    const tick = () => getDeskState().then((d) => alive && setDesk(d)).catch(() => {});
    tick();
    const id = setInterval(tick, act ? 1200 : 6000);
    return () => { alive = false; clearInterval(id); };
  }, [!!act]);

  useEffect(() => {
    if (!act) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [!!act]);

  const elapsed = act ? now - act.startedAt : 0;
  const shownTurns = act
    ? Math.max(0, Math.min(act.turns?.length || 0, Math.floor((elapsed - WALK_MS) / TURN_MS) + 1))
    : 0;

  const startConvene = async () => {
    setConvening(true);
    try { await convene(); } catch (e) { setErr(e.message); }
    finally { setConvening(false); getDeskState().then(setDesk).catch(() => {}); }
  };

  const idx = useMemo(
    () => Object.fromEntries((floor?.agents || []).map((a, i) => [a.id, i])),
    [floor],
  );

  if (err && !floor) return <p className="text-xs text-red-400">{err}</p>;
  if (!floor) return <p className="text-xs text-haze animate-pulse">Opening the floor…</p>;

  const agents = floor.agents;
  const notes = desk?.notes || [];
  const talking = act ? [act.a, act.b] : [];
  const lastSpeaker = shownTurns > 0 ? act?.turns?.[shownTurns - 1]?.agent : null;
  const selAgent = sel && sel !== 'table' ? agents.find((a) => a.id === sel) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm text-neutral-200">The Floor</h1>
          <p className="text-[11px] text-haze">
            {act
              ? `${act.aName} and ${act.bName} are at the desk.`
              : 'Six analysts. Tap one to talk, or tap the desk to read what they\'ve settled.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={startConvene}
            disabled={convening || !!act}
            className="text-[11px] px-2.5 py-1 rounded-md bg-indigo-500/85 text-white disabled:opacity-40"
          >
            {convening || act ? 'in session…' : 'convene the desk'}
          </button>
          <button onClick={onExit} className="text-[11px] text-haze hover:text-neutral-300">cards</button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full block"
          style={{ background: '#08080b' }}
          onClick={() => setSel(null)}
        >
          <defs>
            <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.7" fill="#191921" />
            </pattern>
          </defs>
          <rect width={W} height={H} fill="url(#grid)" />
          <rect x={26} y={26} width={W - 52} height={H - 52} rx={14} fill="none" stroke="#1c1c24" />

          {/* a line from each analyst to the desk; live only while they're talking */}
          {agents.map((a, i) => {
            const h = pt(i, DESK_R - 52);
            const on = talking.includes(a.id);
            return (
              <line
                key={a.id}
                x1={h.x} y1={h.y} x2={CX} y2={CY}
                stroke={on ? a.color : '#17171e'}
                strokeWidth={on ? 1.2 : 1}
                strokeDasharray={on ? '4 4' : undefined}
                style={{ transition: 'stroke .5s' }}
              >
                {on && <animate attributeName="stroke-dashoffset" values="16;0" dur="1s" repeatCount="indefinite" />}
              </line>
            );
          })}

          <Table notes={notes} active={!!act} selected={sel === 'table'} onSelect={setSel} />

          {agents.map((a, i) => (
            <Desk
              key={a.id} agent={a} index={i}
              selected={sel === a.id}
              dim={!!act && !talking.includes(a.id)}
              status={statusFor(a.id, floor.live, act, shownTurns)}
              onSelect={setSel}
            />
          ))}

          {agents.map((a, i) => (
            <Token
              key={a.id} agent={a} index={i}
              atTable={talking.includes(a.id)}
              speaking={lastSpeaker === a.id}
            />
          ))}
        </svg>
      </div>

      {act && (
        <div className="card p-3 space-y-1.5">
          <p className="text-[10px] uppercase tracking-widest text-haze">
            {act.aName} × {act.bName}
          </p>
          <p className="text-[11px] text-neutral-300">{act.topic}</p>
          {act.turns?.slice(0, shownTurns).map((t, i) => (
            <p key={i} className="text-[11px] text-neutral-400">
              <span className="text-ink-500">{t.name}: </span>{t.text}
            </p>
          ))}
          {!shownTurns && <p className="text-[11px] text-haze animate-pulse">gathering their thoughts…</p>}
        </div>
      )}

      {sel === 'table' && !act && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-widest text-haze">
              Desk notes — what the council has settled
            </p>
            <button onClick={() => setSel(null)} className="text-[11px] text-haze hover:text-neutral-300">close</button>
          </div>
          {!notes.length && (
            <p className="text-[11px] text-haze">
              Nothing yet. They talk on their own when you're away, or hit “convene the desk”.
            </p>
          )}
          {notes.map((n) => (
            <div key={n.id}>
              <p className="text-[10px] text-ink-500">
                {(n.participants || []).map((p) => agents.find((a) => a.id === p)?.name || p).join(' × ')}
                {n.ticker ? ` · ${n.ticker}` : ''}
                {n.actionable && <span className="text-amber-400"> · actionable</span>}
              </p>
              <p className="text-[11px] text-neutral-300">{n.conclusion}</p>
              {n.keyPoints?.length > 0 && (
                <ul className="mt-0.5">
                  {n.keyPoints.map((k, i) => <li key={i} className="text-[10px] text-haze">· {k}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {selAgent && !act && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs tracking-wider" style={{ color: selAgent.color }}>
              {selAgent.emoji} {selAgent.name}
            </span>
            <button onClick={() => setSel(null)} className="text-[11px] text-haze hover:text-neutral-300">close</button>
          </div>
          <p className="text-[11px] uppercase tracking-wide text-haze">{selAgent.role}</p>
          <AgentPanel agent={selAgent} data={floor.perAgent[selAgent.id]} onAnalyze={onAnalyze} />
          <AgentChat agent={selAgent} />
        </div>
      )}
    </div>
  );
}
