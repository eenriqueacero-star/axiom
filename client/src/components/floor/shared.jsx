import { useEffect, useRef, useState } from 'react';
import { chatAgent } from '../../api';
import { stanceStyle, stripMd } from '../stance';

export const rel = (ts) => {
  if (!ts) return '';
  const s = (Date.now() - ts) / 1000;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
export const pctS = (n) => (n == null ? '—' : `${Math.round(n * 100)}%`);

// The checks / track-record / recent-calls block for one agent. Shared by the
// card Floor and the 3D room overlay.
export function AgentPanel({ agent, data, onAnalyze, weight, calibration }) {
  const hitRates = Object.entries(data?.stanceStats || {})
    .map(([st, v]) => ({ st, ...v }))
    .filter((v) => v.hitRate != null);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <p className="text-xs text-neutral-400 flex-1">{agent.blurb}</p>
        {weight != null && Math.abs(weight - 1) >= 0.05 && (
          <span
            className="shrink-0 font-mono text-[10px] tracking-wider"
            title="Vote weight, learned from this agent's track record"
            style={{ color: weight > 1 ? '#34d399' : '#e0a33a' }}
          >
            ×{weight.toFixed(2)} vote
          </span>
        )}
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-wide text-haze mb-1">Checks it owns</p>
        <ul className="space-y-0.5">
          {Object.entries(agent.checks || {}).map(([k, label]) => (
            <li key={k} className="text-[11px] text-neutral-400">· {label}</li>
          ))}
        </ul>
      </div>

      {calibration && (
        <div className="rounded border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-amber-400/90 mb-0.5">Calibration note</p>
          <p className="text-[11px] text-neutral-300 leading-snug">{calibration}</p>
        </div>
      )}

      {hitRates.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-haze mb-1">Track record</p>
          {hitRates.map((h) => (
            <p key={h.st} className="text-[11px] text-neutral-400">
              {h.st}: {pctS(h.hitRate)} right ({h.n})
            </p>
          ))}
        </div>
      )}

      {data?.recent?.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-haze mb-1">Recent calls</p>
          <ul className="space-y-1">
            {data.recent.map((c, i) => {
              const cs = stanceStyle(c.stance);
              return (
                <li key={i} className="text-[11px] flex items-start gap-2">
                  <button
                    onClick={() => onAnalyze?.(c.ticker)}
                    className="font-mono text-neutral-300 hover:text-indigo-400 w-12 text-left"
                  >
                    {c.ticker}
                  </button>
                  <span style={{ color: cs.fg }}>{cs.label}</span>
                  <span className="text-haze flex-1">{stripMd(c.note)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export function AgentChat({ agent }) {
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [msgs, busy]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const next = [...msgs, { role: 'user', content: text }];
    setMsgs(next);
    setDraft('');
    setBusy(true);
    try {
      const { reply, consulted } = await chatAgent(agent.id, next);
      setMsgs([...next, { role: 'assistant', content: reply, consulted }]);
    } catch (e) {
      setMsgs([...next, { role: 'assistant', content: `(${e.message})` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-haze mb-1">Talk to {agent.name}</p>
      {msgs.length > 0 && (
        <div className="space-y-1.5 mb-2 max-h-48 overflow-y-auto pr-1">
          {msgs.map((m, i) => (
            <div key={i}>
              {/* real colleague-to-colleague exchanges that happened to answer this */}
              {m.consulted?.map((c, j) => (
                <div key={j} className="my-1.5 pl-2 border-l border-ink-700 space-y-0.5">
                  <p className="text-[10px] text-ink-500">
                    {c.fromName} → {c.toName}: <span className="text-haze">{c.question}</span>
                  </p>
                  <p className="text-[10px] text-neutral-400">
                    <span className="text-ink-500">{c.toName}: </span>{c.answer}
                  </p>
                </div>
              ))}
              <p className={`text-[11px] ${m.role === 'user' ? 'text-neutral-300' : 'text-neutral-400'}`}>
                <span className="text-ink-600">{m.role === 'user' ? 'you' : agent.name}: </span>
                {m.content}
              </p>
            </div>
          ))}
          {busy && <p className="text-[11px] text-haze animate-pulse">{agent.name} is thinking…</p>}
          <div ref={endRef} />
        </div>
      )}
      <div className="flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={`ask ${agent.name}…`}
          className="flex-1 h-8 px-2 rounded bg-ink-900 border border-ink-800 text-[11px] focus:outline-none focus:border-indigo-500/50"
        />
        <button
          onClick={send}
          disabled={busy || !draft.trim()}
          className="h-8 px-3 rounded bg-indigo-500/90 text-white text-[11px] disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
