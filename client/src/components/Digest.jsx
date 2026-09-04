import { useEffect, useState } from 'react';
import { getDigest, markDigestSeen } from '../api';
import Icon from '../ui/Icon';

const VERDICT_COLOR = { ADD: 'var(--good)', HOLD: 'var(--muted)', TRIM: 'var(--warn)', EXIT: 'var(--crit)' };

function relTime(ts) {
  if (!ts) return '';
  const h = Math.round((Date.now() - ts) / 3600000);
  return h < 1 ? '<1h ago' : `${h}h ago`;
}

export default function Digest({ onRun }) {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => { getDigest().then(setD).catch(() => setD(null)); }, []);

  if (!d?.hasContent || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    markDigestSeen().catch(() => {});
  };

  const count = (d.newVerdicts?.length || 0) + (d.signals?.length || 0) + (d.work ? 1 : 0);

  return (
    <div className="border-b border-line bg-panel-2/40 px-6 py-3 sm:px-8">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left">
        <Icon name="desk" size={13} className="text-accent shrink-0" />
        <span className="mono text-[11px] text-text">While you were away — {count} thing{count !== 1 ? 's' : ''}</span>
        <Icon name="chevron" size={11} className={`text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
        <button onClick={(e) => { e.stopPropagation(); dismiss(); }}
          className="press ml-auto mono text-[9px] text-faint hover:text-muted">dismiss</button>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {d.work?.brief && (
            <div>
              <div className="label mb-1">Last night's brief</div>
              <p className="text-[11.5px] leading-relaxed text-muted">{d.work.brief}</p>
            </div>
          )}
          {d.work?.error && (
            <p className="mono text-[10px] text-warn">The overnight run stalled: {d.work.error}</p>
          )}

          {d.newVerdicts?.length > 0 && (
            <div>
              <div className="label mb-1.5">Fresh verdicts</div>
              <ul className="space-y-1">
                {d.newVerdicts.map((v) => (
                  <li key={v.ticker}>
                    <button onClick={() => onRun?.(v.ticker)} className="press flex items-center gap-2 text-left">
                      <span className="mono w-14 text-[12px] text-text">{v.ticker}</span>
                      <span className="mono text-[10px]" style={{ color: VERDICT_COLOR[v.verdict] }}>{v.verdict}</span>
                      {v.tier && <span className="mono text-[9px] text-faint">{v.tier}</span>}
                      <span className="mono ml-auto text-[9px] text-faint">{relTime(v.ts)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {d.signals?.length > 0 && (
            <div>
              <div className="label mb-1.5">New signals</div>
              <ul className="space-y-1">
                {d.signals.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px] text-muted">
                    <span className="mono mt-px shrink-0 text-[9px] text-faint">[{s.kind || 'signal'}]</span>
                    <span className="flex-1">{s.ticker ? `${s.ticker}: ` : ''}{s.headline}</span>
                    <span className="mono shrink-0 text-[9px] text-faint">{relTime(s.ts)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {d.dcaPick && (
            <div>
              <div className="label mb-1">Next contribution</div>
              <button onClick={() => onRun?.(d.dcaPick.ticker)} className="press text-left">
                <span className="mono text-[12px] text-text">{d.dcaPick.ticker}</span>
                <span className="ml-2 text-[11px] text-muted">{d.dcaPick.reason}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
