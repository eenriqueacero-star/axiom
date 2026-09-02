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

const W = 1060;
const H = 560;
const CX = W / 2;
const CY = H / 2 + 8;
// An ellipse, not a circle — the frame is wide, and a circle left the corners
// empty while crowding the top and bottom.
const RX = 352, RY = 176;
const SEAT_R = 112;
const TABLE_R = 78;

const TURN_MS = 4200;
const WALK_MS = 2200;

const ang = (i) => -Math.PI / 2 + (i * Math.PI * 2) / 6;
// k scales the ring inward: 1 = the desk ring, smaller = closer to the centre.
const pt = (i, k = 1) => ({
  x: CX + Math.cos(ang(i)) * RX * k,
  y: CY + Math.sin(ang(i)) * RY * k,
});
const seatPt = (i) => ({
  x: CX + Math.cos(ang(i)) * SEAT_R * 1.35,
  y: CY + Math.sin(ang(i)) * SEAT_R,
});

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
function Desk({ agent, index, selected, dim, live, status, onSelect }) {
  const p = pt(index);
  const w = 208, h = 74;
  const x = p.x - w / 2, y = p.y - h / 2;
  return (
    <g
      className="cursor-pointer"
      onClick={(e) => { e.stopPropagation(); onSelect(agent.id); }}
      style={{ opacity: dim ? 0.35 : 1, transition: 'opacity .4s' }}
    >
      {(selected || live) && (
        <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx={12}
          fill="none" stroke={agent.color} strokeWidth="1" opacity={live ? 0.5 : 0.25} />
      )}
      <rect
        x={x} y={y} width={w} height={h} rx={10}
        fill="#0f0f14"
        stroke={selected || live ? agent.color : '#26262e'}
        strokeWidth={selected || live ? 1.4 : 1}
      />
      <rect x={x} y={y} width={3} height={h} rx={1.5} fill={agent.color} />
      <text x={x + 16} y={y + 25} className="font-mono" fontSize="15" letterSpacing="1.6" fill="#e7e7ea">
        {agent.name}
      </text>
      <text x={x + 16} y={y + 43} fontSize="11.5" fill="#6f6f7c">{agent.role}</text>
      <text x={x + 16} y={y + 62} fontSize="12" fill="#9a9aa6">
        {status.icon} {status.text.length > 24 ? status.text.slice(0, 23) + '…' : status.text}
      </text>
    </g>
  );
}

/* ---------------------------------------------------------------- token */
// The analyst themselves. Slides between desk and table; nothing else moves it.
function Token({ agent, index, atTable, speaking }) {
  const home = pt(index, 0.62);
  const seat = seatPt(index);
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
      <text x={CX} y={CY - 8} textAnchor="middle" fontSize="10.5" letterSpacing="2.5" fill="#5b5b68">THE DESK</text>
      <text x={CX} y={CY + 10} textAnchor="middle" className="font-mono" fontSize="20" fill="#cfcfd6">
        {notes.length}
      </text>
      <text x={CX} y={CY + 24} textAnchor="middle" fontSize="10" fill="#5b5b68">
        {notes.length === 1 ? 'note' : 'notes'}
      </text>
      {/* one dot per desk note, evenly spaced; gold when it's actionable */}
      {notes.slice(0, 18).map((n, i) => {
        const total = Math.min(notes.length, 18);
        const a = -Math.PI / 2 + (i / total) * Math.PI * 2;
        const r = TABLE_R + 13;
        return (
          <circle
            key={n.id || i}
            cx={CX + Math.cos(a) * r} cy={CY + Math.sin(a) * r} r={n.actionable ? 3 : 2}
            fill={n.actionable ? '#facc15' : '#4c4c5a'}
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
              <circle cx="1" cy="1" r="0.7" fill="#17171e" />
            </pattern>
            <radialGradient id="pool">
              <stop offset="0%" stopColor="#2a2f45" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#0a0a10" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width={W} height={H} fill="url(#grid)" />
          <ellipse cx={CX} cy={CY} rx={330} ry={215} fill="url(#pool)" />

          {/* one path per analyst into the desk; it only comes alive for the
              pair that is genuinely in session */}
          {agents.map((a, i) => {
            const h = pt(i, 0.72);
            const on = talking.includes(a.id);
            const mx = (h.x + CX) / 2 + (h.y - CY) * 0.12;
            const my = (h.y + CY) / 2 - (h.x - CX) * 0.12;
            return (
              <path
                key={a.id}
                d={`M ${h.x} ${h.y} Q ${mx} ${my} ${CX} ${CY}`}
                fill="none"
                stroke={on ? a.color : '#191922'}
                strokeWidth={on ? 1.4 : 1}
                strokeDasharray={on ? '5 5' : undefined}
                style={{ transition: 'stroke .5s' }}
              >
                {on && <animate attributeName="stroke-dashoffset" values="20;0" dur="1.1s" repeatCount="indefinite" />}
              </path>
            );
          })}

          <Table notes={notes} active={!!act} selected={sel === 'table'} onSelect={setSel} />

          {agents.map((a, i) => (
            <Desk
              key={a.id} agent={a} index={i}
              selected={sel === a.id}
              live={talking.includes(a.id)}
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
