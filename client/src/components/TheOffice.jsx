import { Component, Suspense, useEffect, useMemo, useState } from 'react';
import { AgentWorkspace } from '../vendor/agent-workspace';
import { getFloor, getDeskState, convene } from '../api';
import { AgentPanel, AgentChat } from './floor/shared';

/**
 * The vendored workspace defines an error boundary but never mounts one, so a
 * throw inside its scene unmounts the whole app. Catch it here: keep Axiom
 * alive and show what actually went wrong.
 */
class SceneBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('[office] scene crashed', err, info); }
  render() {
    if (this.state.err) {
      return (
        <div className="absolute inset-0 grid place-items-center p-6">
          <pre className="max-w-2xl max-h-full overflow-auto text-[11px] text-red-400 whitespace-pre-wrap">
            The 3D office failed to start.{'

'}
            {String(this.state.err?.message || this.state.err)}
            {'

'}{String(this.state.err?.stack || '').slice(0, 1200)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// Which accessory suits each analyst's job.
const ACCESSORY = {
  quality: 'bowtie',    // SAGE — the careful one
  trend: 'visor',       // REX — reads charts
  catalyst: 'headset',  // NOVA — on the news wire
  bear: 'sunglasses',   // VEGA — the sceptic
  sector: 'cap',        // ATLAS
  sizing: undefined,    // ZEN — unadorned, fittingly
};

export default function TheOffice({ onAnalyze, onExit }) {
  const [floor, setFloor] = useState(null);
  const [desk, setDesk] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);
  const [convening, setConvening] = useState(false);

  const act = desk?.activeDialogue || null;

  useEffect(() => {
    let alive = true;
    getFloor().then((f) => alive && setFloor(f)).catch((e) => alive && setErr(e.message));
    const tick = () => getDeskState().then((d) => alive && setDesk(d)).catch(() => {});
    tick();
    const id = setInterval(tick, act ? 1500 : 6000);
    return () => { alive = false; clearInterval(id); };
  }, [!!act]);

  const agents = useMemo(() => (floor?.agents || []).map((a) => {
    const live = floor?.live?.agents?.[a.id];
    const atTable = act && (act.a === a.id || act.b === a.id);
    return {
      id: a.id,
      name: a.name,
      role: a.role,
      color: a.color,
      accessory: ACCESSORY[a.id],
      status: atTable ? 'busy' : live?.busy ? 'active' : 'idle',
    };
  }), [floor, act]);

  // The wall dashboard shows the actual state of the book.
  const stats = useMemo(() => {
    const l = floor?.live?.agents || {};
    const sect = l.sector?.metric?.hottest;
    return {
      Core: `${Math.round((l.sizing?.metric?.corePct || 0) * 100)}%`,
      [sect?.name || 'Top sector']: `${Math.round((sect?.pct || 0) * 100)}%`,
      Flags: l.bear?.metric?.flags ?? 0,
      Notes: desk?.notes?.length ?? 0,
    };
  }, [floor, desk]);

  const startConvene = async () => {
    setConvening(true);
    try { await convene(); } catch (e) { setErr(e.message); }
    finally { setConvening(false); getDeskState().then(setDesk).catch(() => {}); }
  };

  if (err && !floor) return <p className="p-4 text-xs text-red-400">{err}</p>;
  if (!floor) return <p className="p-4 text-xs text-haze animate-pulse">Opening the office…</p>;

  const selAgent = sel ? floor.agents.find((a) => a.id === sel) : null;

  return (
    <div className="fixed inset-0 top-[92px] bg-[#0a0a12]">
      <SceneBoundary>
       <Suspense fallback={null}>
        <AgentWorkspace
          agents={agents}
          rooms={['office', 'boardroom', 'breakroom', 'serverroom', 'rooftop', 'gym']}
          branding={{ name: 'AXIOM', logo: 'AX', color: '#6366f1', tagline: 'THE COUNCIL' }}
          stats={stats}
          theme="dark"
          licenseKey="axiom-council-workspace"
          onAgentClick={(a) => setSel(a.id || floor.agents.find((x) => x.name === a.name)?.id)}
          className="h-full w-full"
        />
       </Suspense>
      </SceneBoundary>

      <div className="absolute top-3 right-3 flex items-center gap-2">
        <button
          onClick={startConvene}
          disabled={convening || !!act}
          className="text-[11px] px-2.5 py-1 rounded-md bg-indigo-500/85 text-white disabled:opacity-40"
        >
          {convening || act ? 'in session…' : 'convene the desk'}
        </button>
        <button onClick={onExit} className="text-[11px] text-haze hover:text-neutral-300 bg-ink-950/60 rounded-md px-2 py-1">
          cards view
        </button>
      </div>

      {act && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-3 w-[min(92vw,640px)] card p-3 bg-ink-950/90 max-h-[38vh] overflow-y-auto">
          <p className="text-[10px] uppercase tracking-widest text-haze mb-1">
            {act.aName} × {act.bName} — at the table
          </p>
          <p className="text-[11px] text-neutral-300 mb-2">{act.topic}</p>
          {act.turns?.map((t, i) => (
            <p key={i} className="text-[11px] text-neutral-400 mb-1">
              <span className="text-ink-500">{t.name}: </span>{t.text}
            </p>
          ))}
          {!act.turns?.length && <p className="text-[11px] text-haze animate-pulse">gathering their thoughts…</p>}
        </div>
      )}

      {selAgent && !act && (
        <div className="absolute right-3 bottom-3 w-[min(92vw,380px)] card p-3 bg-ink-950/92 max-h-[62vh] overflow-y-auto space-y-3">
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
