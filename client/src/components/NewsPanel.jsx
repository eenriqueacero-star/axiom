import { useEffect, useState } from 'react';
import { getTickerNews } from '../api';

const ago = (ts) => {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

export default function NewsPanel({ ticker }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!ticker) return;
    setItems(null);
    setErr('');
    getTickerNews(ticker).then(setItems).catch((e) => setErr(e.message));
  }, [ticker]);

  if (err) return null;

  return (
    <section className="pt-2">
      <h2 className="text-[11px] uppercase tracking-widest text-haze mb-2">
        {ticker} news
      </h2>
      {!items ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 rounded bg-ink-900 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-ink-600">No recent headlines.</p>
      ) : (
        <ul className="divide-y divide-ink-800 card overflow-hidden">
          {items.slice(0, 8).map((n) => (
            <li key={n.id}>
              <a
                href={n.url}
                target="_blank"
                rel="noreferrer noopener"
                className="block px-4 py-3 hover:bg-ink-850 transition-colors"
              >
                <p className="text-sm text-neutral-200 leading-snug">{n.headline}</p>
                <p className="text-xs text-haze mt-1">
                  {n.source} · {ago(n.ts)}
                </p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
