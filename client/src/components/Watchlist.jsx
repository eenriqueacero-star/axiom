import { useEffect, useState } from 'react';
import { getWatchlist, addWatchlist, removeWatchlist } from '../api';
import Icon from '../ui/Icon';

export default function Watchlist({ onRun }) {
  const [items, setItems] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => getWatchlist().then((r) => setItems(r.items || [])).catch(() => setItems([]));
  useEffect(load, []);

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
