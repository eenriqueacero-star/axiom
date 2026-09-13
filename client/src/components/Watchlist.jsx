import { useEffect, useState } from 'react';
import { getWatchlist, addWatchlist, removeWatchlist, getLatestAnalysis } from '../api';
import Icon from '../ui/Icon';

const V_COLOR = { ADD: 'var(--good)', HOLD: 'var(--muted)', TRIM: 'var(--warn)', EXIT: 'var(--crit)' };

export default function Watchlist({ onRun }) {
  const [items, setItems] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [verdicts, setVerdicts] = useState({});

  const load = () => getWatchlist().then((r) => setItems(r.items || [])).catch(() => setItems([]));
  // NOT useEffect(load, []) — load() returns the .then/.catch Promise chain,
  // and React calls whatever an effect returns as its cleanup on unmount.
  // Calling a Promise as a function threw "X is not a function" every time
  // this component unmounted (e.g. navigating Book -> Floor).
  useEffect(() => { load(); }, []);

  // The scout job now rates watchlist names on the same cadence as holdings —
  // pull the latest verdict per ticker so it's not just a bare list.
  useEffect(() => {
    if (!items?.length) return;
    let alive = true;
    items.forEach((i) => {
      getLatestAnalysis(i.ticker).then((r) => {
        if (alive && r?.found) setVerdicts((v) => ({ ...v, [i.ticker]: r.analysis.verdict }));
      }).catch(() => {});
    });
    return () => { alive = false; };
  }, [items]);

  const add = async () => {
    const t = draft.trim().toUpperCase();
    if (!t || busy) return;
    setBusy(true);
    try { await addWatchlist(t); setDraft(''); await load(); } finally { setBusy(false); }
  };

  const remove = async (t) => {
    setItems((prev) => prev.filter((i) => i.ticker !== t));
    await removeWatchlist(t).catch(() => {});
  };

  return (
    <div>
      <div className="label mb-2.5 flex items-center gap-1.5">
        <i className="h-1 w-1 rounded-full bg-muted" /> Watchlist
      </div>
      <div className="mb-2 flex gap-1.5">
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="add a ticker"
          className="mono h-7 min-w-0 flex-1 rounded-md border border-line-2 bg-base px-2 text-[11px] text-text placeholder:text-faint" />
        <button onClick={add} disabled={busy || !draft.trim()}
          className="press grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line-2 text-faint hover:text-text disabled:opacity-40">
          <Icon name="plus" size={12} />
        </button>
      </div>
      {items === null && <p className="text-[11px] text-faint">loading…</p>}
      {items?.length === 0 && <p className="text-[11px] text-faint">Nothing yet — add a ticker you're tracking.</p>}
      {items?.length > 0 && (
        <ul className="flex flex-col gap-1">
          {items.map((i) => (
            <li key={i.ticker} className="flex items-center gap-2">
              <button onClick={() => onRun?.(i.ticker)} className="press mono text-[12px] text-text hover:text-lit">
                {i.ticker}
              </button>
              {verdicts[i.ticker] && (
                <span className="mono text-[9px]" style={{ color: V_COLOR[verdicts[i.ticker]] || 'var(--muted)' }}>
                  {verdicts[i.ticker]}
                </span>
              )}
              <button onClick={() => remove(i.ticker)} className="press ml-auto text-faint hover:text-crit">
                <Icon name="close" size={10} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
