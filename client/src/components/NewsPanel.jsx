const ago = (ts) => {
  if (!ts) return '';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

/** Renders exactly the headlines the council saw (analysis.news). */
export default function NewsPanel({ news, catalyst }) {
  if (!news) return null;

  return (
    <section className="pt-2">
      <h2 className="text-[11px] uppercase tracking-widest text-haze mb-2">
        News the council considered
      </h2>

      {catalyst && (
        <p className="text-xs text-neutral-300 mb-2">
          <span className="text-indigo-400">Key catalyst:</span> {catalyst}
        </p>
      )}

      {news.length === 0 ? (
        <p className="text-xs text-ink-600">No recent headlines were available.</p>
      ) : (
        <ul className="divide-y divide-ink-800 card overflow-hidden">
          {news.map((n, i) => (
            <li key={n.url || i}>
              <a
                href={n.url}
                target="_blank"
                rel="noreferrer noopener"
                className="block px-4 py-3 hover:bg-ink-850 transition-colors"
              >
                <p className="text-sm text-neutral-200 leading-snug">{n.headline}</p>
                <p className="text-xs text-haze mt-1">
                  {n.source}{n.ts ? ` · ${ago(n.ts)}` : n.date ? ` · ${n.date}` : ''}
                </p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
