import { useEffect, useMemo, useRef, useState } from 'react';
import Icon, { AGENT_META } from '../../ui/Icon';
import { chatAgent } from '../../api';

const V_COLOR = { ADD: 'var(--good)', HOLD: 'var(--muted)', TRIM: 'var(--warn)', EXIT: 'var(--crit)' };

function AgentChatPanel({ id, name, ticker }) {
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
      const { reply, consulted } = await chatAgent(id, next, ticker, 'floor');
      setMsgs([...next, { role: 'assistant', content: reply, consulted }]);
    } catch (e) {
      setMsgs([...next, { role: 'assistant', content: `(couldn't reach ${name}: ${e.message})` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[10px] border border-line-2">
      <div className="flex items-center gap-2 border-b border-line-2 px-3 py-2">
        <Icon name="chat" size={13} className="text-faint" />
        <span className="mono text-[10px] uppercase tracking-[0.12em] text-faint">
          Talk to {name}{ticker ? ` · ${ticker}` : ''}
        </span>
      </div>
      <div className="max-h-[240px] min-h-[80px] space-y-2.5 overflow-y-auto px-3 py-3">
        {msgs.length === 0 && !busy && (
          <p className="text-[11px] text-faint">Ask {name} anything in their remit{ticker ? ` — ${ticker} is already in context` : ''}.</p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={m.role === 'user'
              ? 'max-w-[85%] rounded-lg rounded-br-sm bg-panel-2 px-2.5 py-1.5 text-[12px] text-text'
              : 'text-[12px] leading-snug text-muted'}>
              {m.content}
            </div>
          </div>
        ))}
        {busy && <p className="mono text-2xs animate-pulse text-faint">{name} is thinking…</p>}
        <div ref={endRef} />
      </div>
      <div className="flex items-end gap-2 border-t border-line-2 p-2.5">
        <textarea rows={1} value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={`Message ${name}`}
          className="mono max-h-24 min-h-[32px] flex-1 resize-none rounded-md border border-line bg-base px-2.5 py-1.5 text-[12px] text-text placeholder:text-faint" />
        <button onClick={send} disabled={busy || !draft.trim()}
          className="btn-accent h-8 px-3 text-[11px] disabled:opacity-40">send</button>
      </div>
    </div>
  );
}

export function AgentSheet({ id, live, floor, ticker, onAnalyze }) {
  const meta = AGENT_META[id] || { name: id.toUpperCase(), color: 'var(--muted)', remit: '' };
  const per = floor?.perAgent?.[id];
  const blurb = floor?.agents?.find((a) => a.id === id)?.blurb;
  const weight = floor?.weights?.[id];
  const calib = floor?.calibration?.notes?.[id] || floor?.calibration?.[id];
  const busyJob = live?.busy;

  const recent = useMemo(() => (per?.recent || []).slice(0, 5), [per]);
  const working = !!live?.busy;

  return (
    <div className="space-y-4" style={{ color: 'var(--text)' }}>
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-full border" style={{ borderColor: meta.color, color: meta.color }}>
          <Icon name={id} size={15} />
        </span>
        <div>
          <h2 id="sheet-agent-title" className="mono text-xs tracking-[0.14em]">{meta.name}</h2>
          <p className="text-[11px] text-muted">{meta.remit}</p>
        </div>
        {weight != null && (
          <span className="ml-auto mono text-[10px] text-faint">×{Number(weight).toFixed(2)} vote</span>
        )}
      </div>

      {/* work state — the thing you came to see */}
      <div className={`rounded-[10px] border p-3 ${working ? '' : 'border-dashed'}`}
        style={{ borderColor: working ? 'var(--line-2)' : 'var(--line-2)', color: meta.color }}>
        {working ? (
          <>
            <div className="mono text-[9px] uppercase tracking-[0.14em] text-muted">Working on</div>
            <div className="mt-1.5 text-[13px] text-text leading-snug">Autonomous task — {live.reaction ? `read: ${live.reaction}` : 'in progress'}</div>
            <div className="mt-2 mono text-[10px] text-muted">Started by the schedule · progress not yet reported</div>
          </>
        ) : (
          <>
            <div className="mono text-[9px] uppercase tracking-[0.14em] text-muted">Status</div>
            <div className="mt-1 text-[13px] text-faint">Idle — nothing assigned. Standing by for the next event or the nightly run.</div>
          </>
        )}
      </div>

      {blurb && <p className="text-[12px] leading-relaxed text-muted">{blurb}</p>}

      {calib && (
        <div className="rounded-[10px] bg-panel-2 p-3 text-[11.5px] leading-relaxed text-muted">
          <span className="mono text-[9px] uppercase tracking-[0.14em] text-faint">Calibration</span>
          <p className="mt-1">{calib}</p>
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <div className="label mb-2">Recent calls</div>
          <ul className="divide-y divide-line">
            {recent.map((r, i) => (
              <li key={i} className="flex items-center gap-2.5 py-2">
                <button onClick={() => onAnalyze?.(r.ticker)} className="mono text-[12px] text-text w-14 text-left hover:text-lit">{r.ticker}</button>
                {r.verdict && <span className="mono text-[10px]" style={{ color: V_COLOR[r.verdict] || 'var(--muted)' }}>{r.verdict}</span>}
                <span className="text-[11px] text-muted truncate flex-1">{r.note || r.stance}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AgentChatPanel id={id} name={meta.name} ticker={ticker} />
    </div>
  );
}
