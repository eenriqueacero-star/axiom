import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthProvider';
import { markNotificationsRead, getLatestAnalysis } from '../api';

function rel(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const KIND_ICON = {
  news: '📰', filing: '📄', insider: '👤', congress: '🏛️', move: '📈',
  rating: '⚖️', scout: '🔭', desk: '🗒️', opportunity: '💡', macro: '🏦',
};
const SEV_DOT = { critical: 'bg-red-400', review: 'bg-amber-400', fyi: 'bg-ink-600' };

const money = (n) => (n == null ? null : `$${Math.round(n).toLocaleString()}`);
const pct = (x) => (x == null ? null : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);

/** The "what it means for the book" block — pulled from the analysis doc, no re-run. */
function BookImpact({ analysis }) {
  const a = analysis;
  if (!a) return null;
  const econ = a.holdings?.econ;
  const c = a.computed || {};
  const flags = [
    c.broken && 'THESIS BROKEN',
    c.downtrendExit && 'DOWNTREND',
    c.concentrationTrim && 'OVER CAP',
    c.atCap && !c.concentrationTrim && 'AT CAP',
    c.entryClear === false && 'ENTRY NOT CLEAR',
  ].filter(Boolean);

  return (
    <div className="rounded-lg border hairline p-3 space-y-2 bg-ink-900/40">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-widest text-haze">What it means for the book</span>
        <span className="font-mono text-[11px] text-neutral-200">{a.verdict} · {a.conviction}/10 {a.tier ? `· ${a.tier}` : ''}</span>
      </div>
      {econ?.shares != null ? (
        <p className="text-[11px] text-neutral-300 leading-snug">
          We hold <b>{econ.shares} sh</b> at ${Number(econ.avgCost || 0).toFixed(2)} avg
          {econ.value != null && <> — worth <b>{money(econ.value)}</b></>}
          {a.holdings?.positionPct != null && <> ({(a.holdings.positionPct * 100).toFixed(1)}% of the book)</>}
          {econ.unrealPct != null && <>, {econ.unrealPct >= 0 ? 'up' : 'down'} {Math.abs(econ.unrealPct * 100).toFixed(0)}%</>}.
          {a.holdings?.sector && a.holdings?.sectorPct != null && <> {a.holdings.sector} exposure {Math.round(a.holdings.sectorPct * 100)}%.</>}
        </p>
      ) : (
        <p className="text-[11px] text-haze leading-snug">Not currently held.</p>
      )}
      {a.impact && <p className="text-[11px] text-neutral-300 leading-snug">{a.impact}</p>}
      {!a.impact && (a.rationale || c.why) && (
        <p className="text-[11px] text-neutral-300 leading-snug">{a.rationale || c.why}</p>
      )}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {flags.map((f) => <span key={f} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-500/15 text-red-300">{f}</span>)}
        </div>
      )}
      {Array.isArray(a.agents) && a.agents.length > 0 && (
        <ul className="pt-1 space-y-0.5">
          {a.agents.map((ag) => (
            <li key={ag.id || ag.name} className="text-[10px] text-haze leading-snug">
              <span className="text-neutral-400">{ag.name}</span>{ag.stance ? ` — ${ag.stance}` : ''}{ag.note ? `: ${ag.note}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Detail({ n, onClose, onDeepLink }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (n?.refKind === 'analysis' && n.ticker) {
      setLoading(true);
      getLatestAnalysis(n.ticker)
        .then((r) => setAnalysis(r?.found ? r.analysis : null))
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      setAnalysis(null);
    }
  }, [n]);

  if (!n) return null;
  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="card w-full max-w-md my-8 p-5 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span>{KIND_ICON[n.kind] || '•'}</span>
            <h2 className="text-sm text-neutral-100 leading-tight">{n.title}</h2>
          </div>
          <button onClick={onClose} className="text-haze hover:text-neutral-200 text-sm shrink-0">✕</button>
        </div>
        <p className="text-[10px] font-mono text-haze">
          {n.kind}{n.ticker ? ` · ${n.ticker}` : ''} · {rel(n.ts)} ago{n.count > 1 ? ` · ×${n.count}` : ''}
        </p>

        {n.body && <p className="text-xs text-neutral-300 leading-snug">{n.body}</p>}

        {loading && <p className="text-[11px] text-haze">Loading the council's read…</p>}
        {analysis && <BookImpact analysis={analysis} />}

        <div className="flex flex-wrap gap-2 pt-1">
          {n.url && (
            <a href={n.url} target="_blank" rel="noreferrer"
              className="text-[11px] px-2.5 h-7 inline-flex items-center rounded bg-ink-800 text-neutral-300 hover:bg-ink-700">
              Source ↗
            </a>
          )}
          {n.ticker && (
            <button onClick={() => onDeepLink({ analyze: n.ticker })}
              className="text-[11px] px-2.5 h-7 rounded bg-ink-800 text-neutral-300 hover:bg-ink-700">
              Full analysis
            </button>
          )}
          {n.refKind === 'thread' && n.refId && (
            <button onClick={() => onDeepLink({ chat: n.refId })}
              className="text-[11px] px-2.5 h-7 rounded bg-indigo-500 text-white hover:bg-indigo-400">
              Open the thread
            </button>
          )}
          {(n.path && n.path.includes('floor')) && (
            <button onClick={() => onDeepLink({ tab: 'floor' })}
              className="text-[11px] px-2.5 h-7 rounded bg-ink-800 text-neutral-300 hover:bg-ink-700">
              The Floor
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Live notification feed — shared by the panel and the header badge. */
export function useNotifications() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!user) { setItems([]); return; }
    const q = query(
      collection(db, `users/${user.uid}/notifications`),
      orderBy('ts', 'desc'),
      limit(50),
    );
    return onSnapshot(q, (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => {});
  }, [user]);
  const unread = useMemo(() => items.filter((n) => !n.read).length, [items]);
  return { items, unread };
}

export default function Notifications({ open, onClose, onDeepLink, openId, feed }) {
  const [sel, setSel] = useState(null);
  const items = feed?.items || [];

  // deep-link: ?n=<id>
  useEffect(() => {
    if (!openId || !items.length) return;
    const hit = items.find((n) => n.id === openId);
    if (hit) { setSel(hit); if (!hit.read) markNotificationsRead([hit.id]).catch(() => {}); }
  }, [openId, items]);

  const unread = feed?.unread || 0;

  if (!open && !sel) return null;

  const openOne = (n) => {
    setSel(n);
    if (!n.read) markNotificationsRead([n.id]).catch(() => {});
  };

  return (
    <>
      {open && (
      <div className="fixed inset-0 z-30 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
        <div className="card w-full max-w-md my-8 p-5 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-xs tracking-widest text-haze">NOTIFICATIONS</h2>
            <div className="flex items-center gap-3">
              {unread > 0 && (
                <button onClick={() => markNotificationsRead(null)} className="text-[11px] text-indigo-400 hover:text-indigo-300">
                  Mark all read
                </button>
              )}
              <button onClick={onClose} className="text-haze hover:text-neutral-200 text-sm">✕</button>
            </div>
          </div>

          {items.length === 0 ? (
            <p className="text-[11px] text-haze py-2">Nothing yet. News, filings, big moves and the boss's reads land here.</p>
          ) : (
            <ul className="divide-y divide-ink-800 rounded-lg border hairline overflow-hidden max-h-[70vh] overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button onClick={() => openOne(n)} className="w-full text-left px-3 py-2.5 hover:bg-ink-850">
                    <div className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${n.read ? 'bg-transparent' : SEV_DOT[n.severity] || 'bg-amber-400'}`} />
                      <span className="shrink-0">{KIND_ICON[n.kind] || '•'}</span>
                      <span className={`text-xs truncate ${n.read ? 'text-haze' : 'text-neutral-200'}`}>{n.title}</span>
                      <span className="text-[10px] text-ink-600 shrink-0 ml-auto">{rel(n.ts)}</span>
                    </div>
                    {n.body && <p className="text-[11px] text-haze truncate mt-0.5 pl-7">{n.body}</p>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      )}

      <Detail
        n={sel}
        onClose={() => setSel(null)}
        onDeepLink={(d) => { setSel(null); onClose(); onDeepLink?.(d); }}
      />
    </>
  );
}
