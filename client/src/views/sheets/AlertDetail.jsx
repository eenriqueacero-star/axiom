import { useEffect, useState } from 'react';
import Icon from '../../ui/Icon';
import { getLatestAnalysis } from '../../api';

const KIND_ICON = {
  news: 'news', filing: 'filing', insider: 'insider', congress: 'congress',
  move: 'move', rating: 'rating', scout: 'scout', desk: 'desk',
  opportunity: 'opportunity', macro: 'macro',
};
const SEV_LABEL = { critical: 'CRITICAL', review: 'REVIEW', fyi: 'FYI' };
const SEV_CLS = { critical: 'text-crit', review: 'text-warn', fyi: 'text-faint' };

const VERDICT_ICON = { add: 'add', hold: 'hold', trim: 'trim', exit: 'exit' };
const fmtMoney = (n) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`);
const fmtPct = (n) => (n == null ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`);

function fullTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function BookMeaning({ ticker }) {
  const [state, setState] = useState({ loading: true, analysis: null });

  useEffect(() => {
    let alive = true;
    setState({ loading: true, analysis: null });
    getLatestAnalysis(ticker)
      .then((r) => alive && setState({ loading: false, analysis: r?.found ? r.analysis : null }))
      .catch(() => alive && setState({ loading: false, analysis: null }));
    return () => { alive = false; };
  }, [ticker]);

  if (state.loading) return <p className="mt-4 mono text-[10px] text-faint">reading the book…</p>;
  const a = state.analysis;
  if (!a) return null;

  const econ = a.holdings?.econ || {};
  const c = a.computed || {};
  const flags = [
    c.broken && 'thesis broken',
    c.downtrendExit && 'downtrend exit',
    c.concentrationTrim && 'concentration trim',
    c.atCap && 'at cap',
    c.entryClear && 'entry clear',
  ].filter(Boolean);

  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="label mb-2">What it means for the book</div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {a.verdict && (
          <span className="flex items-center gap-1 mono text-xs text-text">
            <Icon name={VERDICT_ICON[a.verdict] || 'check'} size={13} />
            {String(a.verdict).toUpperCase()}
          </span>
        )}
        {a.conviction && <span className="mono text-[10px] text-muted">{String(a.conviction).toUpperCase()} CONVICTION</span>}
        {a.tier && <span className="mono text-[10px] text-faint">{String(a.tier).toUpperCase()}</span>}
      </div>

      {a.headline && <p className="mt-2 text-[12px] leading-snug text-text">{a.headline}</p>}

      {(econ.shares != null || econ.value != null) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 mono text-[10px] text-muted">
          {econ.shares != null && <span>{econ.shares} sh</span>}
          {econ.avgCost != null && <span>avg {fmtMoney(econ.avgCost)}</span>}
          {econ.value != null && <span>{fmtMoney(econ.value)}</span>}
          {a.holdings?.positionPct != null && <span>{(a.holdings.positionPct * 100).toFixed(1)}% of book</span>}
          {econ.unrealPct != null && (
            <span className={econ.unrealPct >= 0 ? 'text-good' : 'text-crit'}>{fmtPct(econ.unrealPct)}</span>
          )}
        </div>
      )}

      {(a.impact || a.rationale) && (
        <p className="mt-3 text-[12px] leading-snug text-muted">{a.impact || a.rationale}</p>
      )}

      {flags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {flags.map((f) => (
            <span key={f} className="rounded-sm border border-line-2 px-1.5 py-0.5 mono text-[9px] uppercase tracking-[0.06em] text-warn">
              {f}
            </span>
          ))}
        </div>
      )}
      {c.why && <p className="mt-2 mono text-[10px] leading-snug text-faint">{c.why}</p>}

      {Array.isArray(a.agents) && a.agents.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {a.agents.map((ag, i) => (
            <li key={i} className="grid grid-cols-[54px_1fr] gap-2 text-[11px] leading-snug">
              <span className="mono text-[10px] text-muted">{String(ag.name || '').toUpperCase()}</span>
              <span className="text-muted">
                <span className="mono text-[10px] text-text">{String(ag.stance || '').toUpperCase()}</span>
                {ag.note ? ` — ${ag.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AlertDetail({ item, onRun, onOpenThread, titleId }) {
  if (!item) {
    return (
      <div className="grid h-full place-items-center px-8 text-center">
        <p className="max-w-[36ch] text-[12px] leading-relaxed text-faint">
          Pick something from the feed to see what it is and what it means for the book.
        </p>
      </div>
    );
  }

  const showBook = item.refKind === 'analysis' || !!item.ticker;

  return (
    <div className="rise-in">
      <div className="flex items-center gap-2">
        <Icon name={KIND_ICON[item.kind] || 'desk'} size={15} className="text-muted" />
        <span className="mono text-[10px] uppercase tracking-[0.12em] text-muted">{item.kind}</span>
        {item.ticker && <span className="mono text-xs text-text">{item.ticker}</span>}
        <span className={`ml-auto mono text-[9px] tracking-[0.1em] ${SEV_CLS[item.severity] || 'text-faint'}`}>
          {SEV_LABEL[item.severity] || ''}
        </span>
      </div>

      <h2 id={titleId} className="mt-2 text-[15px] font-semibold leading-tight text-text">{item.title}</h2>

      <div className="mt-1 flex items-center gap-2 mono text-[10px] text-faint">
        <time>{fullTime(item.ts)}</time>
        {item.count > 1 && <span>· {item.count} together</span>}
      </div>

      {item.body && <p className="mt-3 text-[12px] leading-relaxed text-muted">{item.body}</p>}

      {showBook && item.ticker && <BookMeaning ticker={item.ticker} />}

      <div className="mt-5 flex flex-wrap gap-2">
        {item.ticker && (
          <button onClick={() => onRun?.(item.ticker)} className="btn-accent px-3 py-1.5 text-[11px]">
            Run the council
          </button>
        )}
        {item.url && (
          <a href={item.url} target="_blank" rel="noreferrer" className="btn-ghost px-3 py-1.5 text-[11px]">
            Source <Icon name="chevron" size={10} className="ml-1 inline -rotate-45" />
          </a>
        )}
        {item.refKind === 'thread' && (
          <button onClick={() => onOpenThread?.(item)} className="btn-ghost px-3 py-1.5 text-[11px]">
            Open the thread
          </button>
        )}
      </div>
    </div>
  );
}

export default AlertDetail;
