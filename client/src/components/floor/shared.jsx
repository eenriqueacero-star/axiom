import { useEffect, useRef, useState } from 'react';
import { chatAgent } from '../../api';
import { stanceStyle } from '../stance';

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
export function AgentPanel({ agent, data, onAnalyze }) {
  const hitRates = Object.entries(data?.stanceStats || {})
    .map(([st, v]) => ({ st, ...v }))
    .filter((v) => v.hitRate != null);

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400">{agent.blurb}</p>

      <div>
        <p className="text-[10px] uppercase tracking-wide text-haze mb-1">Checks it owns</p>
        <ul className="space-y-0.5">
          {Object.entries(agent.checks || {}).map(([k, label]) => (
            <li key={k} className="text-[11px] text-neutral-400">· {label}</li>
          ))}
        </ul>
      </div>

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
                  <span className="text-haze flex-1">{c.note}</span>
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
      const { reply } = await chatAgent(agent.id, next);
      setMsgs([...next, { role: 'assistant', content: reply }]);
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
            <p key={i} className={`text-[11px] ${m.role === 'user' ? 'text-neutral-300' : 'text-neutral-400'}`}>
              <span className="text-ink-600">{m.role === 'user' ? 'you' : agent.name}: </span>
              {m.content}
            </p>
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
