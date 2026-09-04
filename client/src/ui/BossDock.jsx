import { useEffect, useRef, useState } from 'react';
import { getBossThreads, getBossThread, newBossThread, sendBossMessage } from '../api';
import { useMedia } from '../hooks/useMedia';
import Icon, { AGENT_META } from './Icon';

function agentHue(name) {
  const key = String(name || '').toLowerCase();
  const hit = Object.values(AGENT_META).find((m) => m.name.toLowerCase() === key || key.includes(m.name.toLowerCase()));
  return hit?.color || 'var(--muted)';
}

function Msg({ m }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] rounded-xl rounded-br-sm bg-panel-2 px-3 py-2 text-[12.5px] leading-snug text-text">
          {m.content}
        </div>
      </div>
    );
  }
  if (m.role === 'agent') {
    return (
      <div className="pl-4">
        <div className="mono text-2xs mb-0.5 uppercase tracking-[0.14em]" style={{ color: agentHue(m.name) }}>
          {m.name || 'analyst'}
        </div>
        <div className="text-[12px] leading-snug text-muted">{m.content}</div>
      </div>
    );
  }
  // boss / assistant
  return (
    <div>
      <div className="mono text-2xs mb-0.5 flex items-center gap-1 uppercase tracking-[0.14em] text-accent">
        <span aria-hidden="true">◆</span> AXIOM
      </div>
      <div className="text-[12.5px] leading-snug text-text">{m.content}</div>
    </div>
  );
}

export default function BossDock({ view, focus, onAction }) {
  const desktop = useMedia('(min-width: 860px)');
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [actions, setActions] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(false);
  const scrollRef = useRef(null);

  // unread dot poll while closed
  useEffect(() => {
    if (open) return;
    let alive = true;
    const check = () =>
      getBossThreads()
        .then((r) => { if (alive) setUnread((r?.threads || []).some((t) => t.unread)); })
        .catch(() => {});
    check();
    const id = setInterval(check, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [open]);

  // load newest thread on first open
  useEffect(() => {
    if (!open || threadId) return;
    let alive = true;
    getBossThreads()
      .then(async (r) => {
        const list = (r?.threads || []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        if (!alive) return;
        if (list[0]) {
          setThreadId(list[0].id);
          const full = await getBossThread(list[0].id).catch(() => null);
          if (alive && full?.thread) setMessages(full.thread.messages || []);
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [open, threadId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const openDock = () => { setOpen(true); setUnread(false); };

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setText('');
    setActions([]);
    setSending(true);
    setMessages((m) => [...m, { role: 'user', content: t, ts: Date.now() }]);
    try {
      let id = threadId;
      if (!id) {
        const created = await newBossThread('Boss');
        id = created?.thread?.id;
        setThreadId(id);
      }
      const r = await sendBossMessage(id, t, { view, focus });
      if (Array.isArray(r?.messages) && r.messages.length) setMessages(r.messages);
      else if (r?.reply) setMessages((m) => [...m, { role: 'assistant', content: r.reply, ts: Date.now() }]);
      setActions(Array.isArray(r?.actions) ? r.actions : []);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `(couldn't reach the desk: ${e.message})`, ts: Date.now() }]);
    }
    setSending(false);
  };

  const runAction = (a) => {
    onAction?.(a);
    setOpen(false);
  };

  const ctx = `on the ${view || 'floor'} screen${focus ? ` · ${focus}` : ''}`;

  const panelPos = desktop
    ? `right-0 top-0 h-dvh w-[380px] max-w-[92vw] border-l border-line-2 ${open ? 'translate-x-0' : 'translate-x-full'}`
    : `inset-x-0 bottom-0 h-[82dvh] rounded-t-[22px] border-t border-line-2 ${open ? 'translate-y-0' : 'translate-y-full'}`;

  return (
    <>
      {!open && (
        <button onClick={openDock} aria-label="Talk to the boss"
          className={`press fixed z-40 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-base
            ${desktop ? 'bottom-4 right-4' : 'bottom-[76px] right-4'}`}
          style={{ boxShadow: '0 0 0 1px var(--line-2), 0 8px 30px var(--accent-glow)' }}>
          <Icon name="chat" size={18} />
          {unread && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-crit ring-2 ring-base" />}
        </button>
      )}

      <div onClick={() => setOpen(false)} aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300
          ${open ? 'opacity-100' : 'pointer-events-none opacity-0'} ${desktop ? 'md:bg-black/30' : ''}`} />

      <div role="dialog" aria-modal="true" aria-labelledby="bossdock-title"
        className={`fixed z-50 flex flex-col bg-panel
          transition-transform duration-[360ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${panelPos}`}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span aria-hidden="true" className="text-accent">◆</span>
          <h2 id="bossdock-title" className="font-wide text-[13px] text-text">THE BOSS</h2>
          <span className="mono text-2xs ml-2 truncate text-faint">{ctx}</span>
          <button onClick={() => setOpen(false)} aria-label="Close"
            className="press ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted hover:text-text">
            <Icon name="close" size={14} />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 && !sending && (
            <p className="mono text-2xs text-faint">
              Ask the boss anything — a ticker, a call, what the desk is doing.
            </p>
          )}
          {messages.map((m, i) => <Msg key={m.ts ? `${m.ts}-${i}` : i} m={m} />)}
          {actions.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {actions.map((a, i) => (
                <button key={i} onClick={() => runAction(a)}
                  className="press rounded-full border border-accent/50 px-3 py-1 text-[11px] text-accent">
                  {a.label}
                </button>
              ))}
            </div>
          )}
          {sending && (
            <div className="mono text-2xs flex items-center gap-1 text-faint">
              <span className="animate-pulse">AXIOM is thinking…</span>
            </div>
          )}
        </div>

        <div className="border-t border-line p-3">
          <div className="flex items-end gap-2">
            <textarea
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              placeholder="Message the boss"
              className="mono max-h-28 min-h-[36px] flex-1 resize-none rounded-lg border border-line bg-base px-3 py-2 text-[12px] text-text placeholder:text-faint"
            />
            <button onClick={send} disabled={sending || !text.trim()}
              className="btn-accent h-9 px-3.5 text-[12px] disabled:opacity-40">
              send
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
