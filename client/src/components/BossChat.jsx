import { useEffect, useRef, useState } from 'react';
import {
  getBossThreads, getBossThread, newBossThread, sendBossMessage, resolveBossThread, getAgents,
} from '../api';

function rel(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const AXIOM_META = { id: 'axiom', name: 'AXIOM', emoji: '◆', color: '#8b9cff' };

function Avatar({ meta, size = 22 }) {
  const m = meta || { name: '?', emoji: '•', color: '#7c8db5' };
  return (
    <span
      className="inline-flex items-center justify-center rounded-full shrink-0 font-mono"
      style={{ width: size, height: size, background: `${m.color}22`, color: m.color, fontSize: size * 0.5 }}
      title={m.name}
    >
      {m.emoji || m.name[0]}
    </span>
  );
}

function ThreadList({ threads, onOpen, onNew }) {
  return (
    <div className="space-y-2">
      <button onClick={onNew}
        className="w-full h-9 rounded-lg bg-indigo-500 text-white text-xs font-medium hover:bg-indigo-400">
        New conversation with the boss
      </button>
      {threads.length === 0 ? (
        <p className="text-[11px] text-haze py-2">No conversations yet. The boss pings you here when an event needs your read.</p>
      ) : (
        <ul className="divide-y divide-ink-800 rounded-lg border hairline overflow-hidden">
          {threads.map((t) => (
            <li key={t.id}>
              <button onClick={() => onOpen(t.id)}
                className="w-full text-left px-3 py-2.5 hover:bg-ink-850">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-neutral-200 truncate">
                    {t.unread && <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-400 mr-1.5 align-middle" />}
                    {t.title}
                  </span>
                  <span className="text-[10px] text-ink-600 shrink-0 ml-2">{rel(t.updatedAt)}</span>
                </div>
                {t.preview && <p className="text-[11px] text-haze truncate mt-0.5">{t.preview}</p>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Thread({ id, agents, onBack }) {
  const [thread, setThread] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const metaFor = (agentId) => (agentId === 'axiom' ? AXIOM_META : agents[agentId]) || (agentId ? { name: agentId, emoji: '•', color: '#7c8db5' } : AXIOM_META);

  useEffect(() => { getBossThread(id).then((r) => setThread(r.thread)).catch(() => setThread(null)); }, [id]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread?.messages?.length, busy]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    setBusy(true);
    setThread((t) => ({ ...t, messages: [...(t?.messages || []), { role: 'user', content: text, ts: Date.now() }] }));
    try {
      const r = await sendBossMessage(id, text);
      setThread((t) => ({ ...t, messages: r.messages }));
    } catch {
      setThread((t) => ({ ...t, messages: [...(t?.messages || []), { role: 'assistant', content: 'Lost that one — say it again?', ts: Date.now() }] }));
    } finally {
      setBusy(false);
    }
  };

  const setAside = async () => {
    await resolveBossThread(id, 'archive').catch(() => {});
    onBack(true);
  };

  if (!thread) return <p className="text-[11px] text-haze py-4">Loading…</p>;

  return (
    <div className="flex flex-col h-[60vh]">
      <div className="flex items-center justify-between pb-2 border-b hairline">
        <button onClick={() => onBack()} className="text-[11px] text-haze hover:text-neutral-200">← all chats</button>
        {thread.seededEvent && !thread.resolved && (
          <button onClick={setAside} className="text-[11px] text-haze hover:text-neutral-300">set aside →</button>
        )}
      </div>

      {thread.seededEvent && (
        <div className="mt-2 rounded-lg border hairline p-2.5 text-[11px]">
          <span className="text-ink-600">what came in: </span>
          <span className="text-neutral-300">{thread.seededEvent.headline}</span>
          {thread.seededEvent.url && (
            <a href={thread.seededEvent.url} target="_blank" rel="noreferrer noopener"
              className="text-indigo-400 hover:text-indigo-300"> ↗</a>
          )}
        </div>
      )}
      {thread.seededDecision && (
        <div className="mt-2 rounded-lg border hairline p-2.5 text-[11px]">
          <span className="font-mono text-[9px] uppercase tracking-wider text-ink-600">{thread.seededDecision.mandate}</span>{' '}
          <span className="text-neutral-200 font-semibold">{thread.seededDecision.verdict} {thread.seededDecision.ticker}</span>
          <span className="text-ink-600"> · {thread.seededDecision.conviction}/10</span>
          {thread.seededDecision.why && <p className="text-haze mt-0.5">{thread.seededDecision.why}</p>}
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-3 space-y-2">
        {(thread.messages || []).map((m, i) => {
          if (m.role === 'user') {
            return (
              <div key={i} className="text-right">
                <div className="inline-block max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-snug text-left bg-indigo-500 text-white whitespace-pre-wrap">
                  {m.content}
                </div>
              </div>
            );
          }
          if (m.role === 'consult') {
            return (
              <div key={i} className="text-center">
                <span className="inline-block text-[11px] text-haze bg-ink-900 rounded-full px-3 py-1 border hairline">💬 {m.content}</span>
              </div>
            );
          }
          // assistant (boss) or agent (pulled in)
          const meta = metaFor(m.agentId || 'axiom');
          return (
            <div key={i} className="space-y-1">
              {m.joined && (
                <div className="text-center py-1">
                  <span className="inline-flex items-center gap-1.5 text-[10px] text-haze bg-ink-900 rounded-full px-2.5 py-1 border hairline">
                    <Avatar meta={meta} size={14} />
                    <span className="font-mono" style={{ color: meta.color }}>{meta.name}</span> joined the chat
                  </span>
                </div>
              )}
              <div className="flex items-start gap-2">
                <Avatar meta={meta} />
                <div className="min-w-0">
                  <p className="text-[10px] font-mono mb-0.5" style={{ color: meta.color }}>{meta.name}</p>
                  <div className="inline-block max-w-[92%] rounded-2xl px-3 py-2 text-[13px] leading-snug bg-ink-850 text-neutral-200 whitespace-pre-wrap">
                    {m.content}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {busy && <div className="text-[11px] text-haze animate-pulse pl-8">the desk is working…</div>}
        <div ref={endRef} />
      </div>

      <div className="flex gap-2 pt-2 border-t hairline">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="talk to the boss…"
          className="flex-1 h-9 rounded-lg bg-ink-900 border hairline px-3 text-xs text-neutral-100 placeholder:text-ink-600"
        />
        <button onClick={send} disabled={busy || !draft.trim()}
          className="h-9 px-4 rounded-lg bg-indigo-500 text-white text-xs font-medium disabled:opacity-40">
          Send
        </button>
      </div>
    </div>
  );
}

export default function BossChat({ open, initialThreadId, onClose }) {
  const [threads, setThreads] = useState([]);
  const [active, setActive] = useState(initialThreadId || null);
  const [agents, setAgents] = useState({});

  const loadThreads = () => getBossThreads().then((r) => setThreads(r.threads || [])).catch(() => {});
  useEffect(() => { getAgents().then((list) => setAgents(Object.fromEntries((list || []).map((a) => [a.id, a])))).catch(() => {}); }, []);
  useEffect(() => { if (open) { loadThreads(); setActive(initialThreadId || null); } }, [open, initialThreadId]);

  if (!open) return null;

  const openNew = async () => {
    try { const r = await newBossThread(); setActive(r.thread.id); } catch { /* ignore */ }
  };

  return (
    <div className="fixed inset-0 z-30 bg-black/50 flex items-start justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-md mt-12 p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs tracking-widest text-haze">THE BOSS</h2>
          <button onClick={onClose} className="text-haze hover:text-neutral-200 text-sm">✕</button>
        </div>
        {active ? (
          <Thread id={active} agents={agents} onBack={(changed) => { setActive(null); if (changed) loadThreads(); }} />
        ) : (
          <ThreadList threads={threads} onOpen={setActive} onNew={openNew} />
        )}
      </div>
    </div>
  );
}
