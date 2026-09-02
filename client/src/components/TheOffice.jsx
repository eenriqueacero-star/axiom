import { useEffect, useMemo, useRef, useState } from 'react';
import { getFloor, getDeskState, convene } from '../api';
import { AgentPanel, AgentChat } from './floor/shared';

/**
 * The Floor as a transit map.
 *
 * Six stations wired to a central hub — THE DESK — with a ring line joining
 * neighbours. Nothing on this map is decorative: a packet only travels when
 * something genuinely moved. A turn spoken at the desk sends one from that
 * analyst down its spoke; a finished note pushes one out to every station,
 * because every analyst really does read it back; a running cron job pulls
 * packets inbound. If the map is still, the council is idle.
 */

const W = 1060;
const H = 600;
const CX = W / 2;
const CY = H / 2;
const RX = 340, RY = 190;     // where the stations sit
const HUB_R = 62;

const TURN_MS = 4200;
const WALK_MS = 900;
const PACKET_MS = 1300;

const ang = (i) => -Math.PI / 2 + (i * Math.PI * 2) / 6;
const node = (i) => ({ x: CX + Math.cos(ang(i)) * RX, y: CY + Math.sin(ang(i)) * RY });

/** Spoke from a station into the hub, with an elbow so it reads as a route. */
function spokePath(i) {
  const n = node(i);
  const a = ang(i);
  const hub = { x: CX + Math.cos(a) * HUB_R, y: CY + Math.sin(a) * HUB_R };
  const bend = { x: CX + Math.cos(a) * (RX * 0.52), y: CY + Math.sin(a) * (RY * 0.52) };
  return `M ${n.x} ${n.y} L ${bend.x} ${bend.y} L ${hub.x} ${hub.y}`;
}

/** Ring line between neighbouring stations. */
function ringPath(i) {
  const a = node(i), b = node((i + 1) % 6);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const k = 1.16;
  return `M ${a.x} ${a.y} Q ${CX + (mx - CX) * k} ${CY + (my - CY) * k} ${b.x} ${b.y}`;
}

function statusFor(id, live, act, shownTurns) {
  if (act && (act.a === id || act.b === id)) {
    const other = act.a === id ? act.bName : act.aName;
    if (act.phase === 'writing') return { icon: '✍️', text: 'writing the note up' };
    const last = shownTurns > 0 ? act.turns?.[shownTurns - 1] : null;
    if (last && last.agent === id) return { icon: '🗣️', text: `arguing with ${other}` };
    return { icon: '👂', text: `listening to ${other}` };
  }
  const a = live?.agents?.[id];
  if (a?.busy) return { icon: '📊', text: 'running its checks' };
  const m = a?.metric || {};
  switch (id) {
    case 'trend':
      if (m.trendScore > 0.3) return { icon: '📈', text: 'above their 200-day' };
      if (m.trendScore < -0.3) return { icon: '📉', text: `${m.downtrending?.length || 0} in a downtrend` };
      return { icon: '📐', text: 'trend is mixed' };
    case 'bear':
      if (m.high) return { icon: '🚨', text: `${m.high} serious flag${m.high > 1 ? 's' : ''}` };
      if (m.flags) return { icon: '⚠️', text: `${m.flags} rulebook flags` };
      return { icon: '🔍', text: 'nothing broken' };
    case 'catalyst':
      if (m.freshNews) return { icon: '📰', text: `news on ${m.tickers?.slice(0, 2).join(', ')}` };
      return { icon: '📭', text: 'no new catalysts' };
    case 'sector':
      if (m.hottest?.overCap) return { icon: '🌡️', text: `${m.hottest.name} ${Math.round(m.hottest.pct * 100)}%` };
      return { icon: '🌐', text: 'sectors within cap' };
    case 'sizing':
      if (m.tilt != null && Math.abs(m.tilt) > 0.5) return { icon: '⚖️', text: `Core ${Math.round((m.corePct || 0) * 100)}% vs 50%` };
      return { icon: '⚖️', text: 'sleeves near target' };
    case 'quality':
      if (m.coreBroken?.length) return { icon: '🛡️', text: `watching ${m.coreBroken.join(', ')}` };
      return { icon: '🛡️', text: `${m.coreHeld || 0} Core names` };
    default:
      return { icon: '·', text: 'idle' };
  }
}

/* --------------------------------------------------------------- packet */
// A single piece of information moving down a tunnel.
function Packet({ pathId, color, reverse, dur }) {
  const kp = reverse ? '1;0' : '0;1';
  return (
    <g>
      <circle r="5" fill={color} opacity="0.22">
        <animateMotion dur={`${dur}ms`} fill="freeze" calcMode="linear" keyPoints={kp} keyTimes="0;1">
          <mpath href={`#${pathId}`} />
        </animateMotion>
      </circle>
      <circle r="2.6" fill={color}>
        <animateMotion dur={`${dur}ms`} fill="freeze" calcMode="linear" keyPoints={kp} keyTimes="0;1">
          <mpath href={`#${pathId}`} />
        </animateMotion>
      </circle>
    </g>
  );
}

/* -------------------------------------------------------------- station */
function Station({ agent, index, selected, live, status, onSelect }) {
  const p = node(index);
  const c = Math.cos(ang(index));
  const vertical = Math.abs(c) <= 0.1;
  const right = c > 0.1;
  const anchor = vertical ? 'middle' : right ? 'start' : 'end';
  const dx = vertical ? 0 : right ? 22 : -22;
  const dy = vertical ? (Math.sin(ang(index)) > 0 ? 42 : -30) : 0;

  return (
    <g className="cursor-pointer" onClick={(e) => { e.stopPropagation(); onSelect(agent.id); }}>
      {live && (
        <circle cx={p.x} cy={p.y} r={14} fill="none" stroke={agent.color} strokeWidth="1.5">
          <animate attributeName="r" values="12;26" dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.8;0" dur="1.6s" repeatCount="indefinite" />
        </circle>
      )}
      <circle cx={p.x} cy={p.y} r={selected ? 13 : 11} fill="#0b0b10" stroke={agent.color} strokeWidth="2.5" />
      <circle cx={p.x} cy={p.y} r={4} fill={agent.color} />
      <text x={p.x + dx} y={p.y + dy - 3} textAnchor={anchor} className="font-mono"
        fontSize="14" letterSpacing="1.6" fill={selected ? '#ffffff' : '#dcdce2'}>
        {agent.name}
      </text>
      <text x={p.x + dx} y={p.y + dy + 13} textAnchor={anchor} fontSize="11" fill="#7b7b88">
        {status.icon} {status.text}
      </text>
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
  const [packets, setPackets] = useState([]);
  const act = desk?.activeDialogue || null;

  const send = (p) => {
    const id = `${Date.now()}-${Math.random()}`;
    setPackets((ps) => [...ps, { ...p, id }]);
    setTimeout(() => setPackets((ps) => ps.filter((x) => x.id !== id)), p.dur + 150);
  };

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

  const idx = useMemo(
    () => Object.fromEntries((floor?.agents || []).map((a, i) => [a.id, i])),
    [floor],
  );

  // a spoken turn = one packet from that analyst into the desk
  const lastFired = useRef(0);
  useEffect(() => {
    if (!act) { lastFired.current = 0; return; }
    if (!shownTurns || shownTurns === lastFired.current) return;
    lastFired.current = shownTurns;
    const speaker = act.turns?.[shownTurns - 1]?.agent;
    const i = idx[speaker];
    const colour = floor?.agents?.find((a) => a.id === speaker)?.color;
    if (i != null && colour) send({ pathId: `spoke-${i}`, color: colour, reverse: false, dur: PACKET_MS });
  }, [shownTurns, act, idx, floor]);

  // a finished note goes back out to every station — they all read it later
  const noteCount = desk?.notes?.length ?? 0;
  const prevNotes = useRef(null);
  useEffect(() => {
    if (prevNotes.current == null) { prevNotes.current = noteCount; return; }
    if (noteCount > prevNotes.current) {
      (floor?.agents || []).forEach((_, i) => {
        setTimeout(() => send({ pathId: `spoke-${i}`, color: '#facc15', reverse: true, dur: PACKET_MS + 200 }), i * 90);
      });
    }
    prevNotes.current = noteCount;
  }, [noteCount, floor]);

  // a cron job actually running pulls data inbound to that station
  useEffect(() => {
    const busy = (floor?.agents || []).filter((a) => floor?.live?.agents?.[a.id]?.busy);
    if (!busy.length) return;
    const id = setInterval(() => {
      busy.forEach((a) => send({ pathId: `spoke-${idx[a.id]}`, color: a.color, reverse: true, dur: PACKET_MS }));
    }, 2600);
    return () => clearInterval(id);
  }, [floor, idx]);

  const startConvene = async () => {
    setConvening(true);
    try { await convene(); } catch (e) { setErr(e.message); }
    finally { setConvening(false); getDeskState().then(setDesk).catch(() => {}); }
  };

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
              ? `${act.aName} and ${act.bName} are at the desk — watch the line.`
              : 'Tap a station to talk to an analyst, or the hub to read what they\'ve settled.'}
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
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ background: '#07070a' }}
          onClick={() => setSel(null)}>
          <defs>
            <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.7" fill="#15151c" />
            </pattern>
            <radialGradient id="pool">
              <stop offset="0%" stopColor="#232a44" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#07070a" stopOpacity="0" />
            </radialGradient>
            {agents.map((_, i) => <path key={i} id={`spoke-${i}`} d={spokePath(i)} fill="none" />)}
            {agents.map((_, i) => <path key={`r${i}`} id={`ring-${i}`} d={ringPath(i)} fill="none" />)}
          </defs>

          <rect width={W} height={H} fill="url(#grid)" />
          <ellipse cx={CX} cy={CY} rx={330} ry={220} fill="url(#pool)" />

          {/* ring line between neighbours */}
          {agents.map((_, i) => (
            <g key={`ring${i}`}>
              <path d={ringPath(i)} fill="none" stroke="#0e0e14" strokeWidth="9" strokeLinecap="round" />
              <path d={ringPath(i)} fill="none" stroke="#1c1c26" strokeWidth="3" strokeLinecap="round" />
            </g>
          ))}

          {/* spokes into the hub, lit in the analyst's colour while in session */}
          {agents.map((a, i) => {
            const on = talking.includes(a.id);
            return (
              <g key={`spoke${i}`}>
                <path d={spokePath(i)} fill="none" stroke="#0e0e14" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
                <path
                  d={spokePath(i)} fill="none"
                  stroke={on ? a.color : '#232330'} strokeWidth={on ? 3.5 : 3}
                  strokeLinecap="round" strokeLinejoin="round"
                  opacity={on ? 0.95 : 0.8}
                  style={{ transition: 'stroke .5s' }}
                />
              </g>
            );
          })}

          {/* the hub */}
          <g className="cursor-pointer" onClick={(e) => { e.stopPropagation(); setSel('table'); }}>
            <circle cx={CX} cy={CY} r={HUB_R} fill="#0a0a11" stroke={act ? '#8ea2ff' : '#262633'} strokeWidth={act ? 2 : 1.5}>
              {act && <animate attributeName="stroke-opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />}
            </circle>
            <circle cx={CX} cy={CY} r={HUB_R - 9} fill="none" stroke="#1a1a24" strokeWidth="1" />
            <text x={CX} y={CY - 10} textAnchor="middle" fontSize="9.5" letterSpacing="2.6" fill="#5e5e6e">THE DESK</text>
            <text x={CX} y={CY + 12} textAnchor="middle" className="font-mono" fontSize="22" fill="#e2e2e8">{notes.length}</text>
            <text x={CX} y={CY + 27} textAnchor="middle" fontSize="9" fill="#5e5e6e">
              {notes.length === 1 ? 'note' : 'notes'}
            </text>
          </g>

          {agents.map((a, i) => (
            <Station
              key={a.id} agent={a} index={i}
              selected={sel === a.id}
              live={lastSpeaker === a.id || (!act && !!floor.live?.agents?.[a.id]?.busy)}
              status={statusFor(a.id, floor.live, act, shownTurns)}
              onSelect={setSel}
            />
          ))}

          {/* information in transit */}
          {packets.map((p) => (
            <Packet key={p.id} pathId={p.pathId} color={p.color} reverse={p.reverse} dur={p.dur} />
          ))}
        </svg>
      </div>

      {act && (
        <div className="card p-3 space-y-1.5">
          <p className="text-[10px] uppercase tracking-widest text-haze">{act.aName} × {act.bName}</p>
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
            <p className="text-[11px] uppercase tracking-widest text-haze">Desk notes — what the council has settled</p>
            <button onClick={() => setSel(null)} className="text-[11px] text-haze hover:text-neutral-300">close</button>
          </div>
          {!notes.length && (
            <p className="text-[11px] text-haze">Nothing yet. They talk on their own when you're away, or hit “convene the desk”.</p>
          )}
          {notes.map((n) => (
            <div key={n.id}>
              <p className="text-[10px] text-ink-500">
                {(n.participants || []).map((p) => agents.find((a) => a.id === p)?.name || p).join(' × ')}
                {n.ticker ? ` · ${n.ticker}` : ''}
                {n.actionable && <span className="text-amber-400"> · actionable</span>}
              </p>
              <p className="text-[11px] text-neutral-300">{n.conclusion}</p>
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
          <AgentPanel agent={selAgent} data={floor.perAgent[selAgent.id]} weight={floor.weights?.[selAgent.id]} onAnalyze={onAnalyze} />
          <AgentChat agent={selAgent} />
        </div>
      )}
    </div>
  );
}
