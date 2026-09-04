import { useMemo } from 'react';
import Icon, { AGENT_META } from '../../ui/Icon';

const V_COLOR = { ADD: 'var(--good)', HOLD: 'var(--muted)', TRIM: 'var(--warn)', EXIT: 'var(--crit)' };

export function AgentSheet({ id, live, floor, onAnalyze }) {
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

      <div className="flex items-center gap-2.5 rounded-[10px] border border-line-2 px-3.5 py-3 text-[12px] text-faint">
        <Icon name="chat" size={14} />
        Talk to {meta.name} — coming in the Floor build
      </div>
    </div>
  );
}
