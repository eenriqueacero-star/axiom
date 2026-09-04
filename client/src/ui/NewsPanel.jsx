import { useEffect, useState } from 'react';
import { getMarketNews } from '../api';

function rel(ts) {
  if (!ts) return '';
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!t || Number.isNaN(t)) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// getMarketNews shape is not guaranteed — pull whatever list of items we can find.
function normalize(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw)
    ? raw
    : raw.articles || raw.news || raw.items || raw.headlines || raw.results || [];
  if (!Array.isArray(list)) return [];
  return list
    .map((a, i) => {
      if (!a || typeof a !== 'object') return null;
      const headline = a.headline || a.title || a.text || a.summary || '';
      if (!headline) return null;
      return {
        key: a.id || a.url || `${headline}-${i}`,
        headline,
        source: a.source || a.publisher || a.site || a.provider || '',
        url: a.url || a.link || a.href || '',
        ts: a.ts || a.publishedAt || a.published_at || a.datetime || a.date || a.time || null,
        tickers: Array.isArray(a.tickers) ? a.tickers : Array.isArray(a.symbols) ? a.symbols : [],
      };
    })
    .filter(Boolean);
}

export default function NewsPanel({ compact }) {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getMarketNews()
        .then((r) => { if (alive) { setItems(normalize(r)); setLoaded(true); } })
        .catch(() => { if (alive) setLoaded(true); });
    load();
    const id = setInterval(load, 60000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const shown = compact ? items.slice(0, 5) : items;

  if (loaded && shown.length === 0) {
    return <p className="text-[11px] text-faint">Nothing on the wire.</p>;
  }

  return (
    <ul className={compact ? 'space-y-2' : 'space-y-3'}>
      {shown.map((n) => {
        const meta = (
          <div className="mono text-2xs text-faint flex items-center gap-1.5">
            {n.source && <span className="uppercase tracking-[0.12em]">{n.source}</span>}
            {n.ts && <span>· {rel(n.ts)}</span>}
            {n.tickers.slice(0, 3).map((t) => (
              <span key={t} className="text-muted">{String(t).toUpperCase()}</span>
            ))}
          </div>
        );
        const inner = (
          <>
            {meta}
            <div className={`text-text leading-snug ${compact ? 'text-[11.5px] mt-0.5' : 'text-[12.5px] mt-1'}`}>
              {n.headline}
            </div>
          </>
        );
        return (
          <li key={n.key}>
            {n.url ? (
              <a href={n.url} target="_blank" rel="noreferrer"
                className="press block rounded-md px-1 py-1 -mx-1 hover:bg-panel-2">
                {inner}
              </a>
            ) : (
              <div className="px-1 py-1">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
