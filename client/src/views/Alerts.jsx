import { useEffect, useMemo, useRef, useState } from 'react';
import { useNotifications } from '../hooks/useNotifications';
import { markNotificationsRead, getNotifyPrefs, setNotifyPrefs, getCongress } from '../api';
import Icon from '../ui/Icon';
import Sheet from '../ui/Sheet';
import { AlertDetail } from './sheets/AlertDetail';

const KIND_ICON = {
  news: 'news', filing: 'filing', insider: 'insider', congress: 'congress',
  move: 'move', rating: 'rating', scout: 'scout', desk: 'desk',
  opportunity: 'opportunity', macro: 'macro',
};
const KIND_LABEL = {
  news: 'News', filing: 'Filings', insider: 'Insider', congress: 'Congress',
  move: 'Moves', rating: 'Ratings', scout: 'Scout', desk: 'Desk',
  opportunity: 'Opps', macro: 'Macro',
};
const PREF_KINDS = ['news', 'filing', 'insider', 'congress', 'move', 'rating', 'scout', 'desk', 'opportunity', 'macro'];
const SEV_DOT = { critical: 'bg-crit', review: 'bg-warn', fyi: 'bg-[var(--faint)]' };
const CYCLE = { push: 'digest', digest: 'off', off: 'push' };
const STATE_CLS = { push: 'text-good border-[var(--good)]', digest: 'text-warn border-[var(--warn)]', off: 'text-faint border-line-2' };

function relTime(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
const money = (n) => (n == null ? '' : `$${Math.round(n).toLocaleString()}`);

function FeedRow({ n, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`press grid w-full grid-cols-[16px_1fr_auto] items-start gap-3 border-b border-line px-4 py-3 text-left
        ${active ? 'bg-white/[0.03]' : ''}`}
    >
      <span className="relative mt-0.5">
        <Icon name={KIND_ICON[n.kind] || 'desk'} size={15} className="text-muted" />
        <i className={`absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full ${SEV_DOT[n.severity] || 'bg-faint'}`} />
      </span>
      <span className="min-w-0">
        <span className={`flex items-center gap-1.5 text-[13px] leading-tight ${n.read ? 'text-muted' : 'font-semibold text-text'}`}>
          {n.ticker && <span className="mono text-[11px] text-faint">{n.ticker}</span>}
          <span className="truncate">{n.title}</span>
        </span>
        {n.body && <span className="mt-0.5 block truncate text-[11px] text-faint">{n.body}</span>}
      </span>
      <span className="flex items-center gap-1.5">
        {!n.read && <i className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
        <time className="mono text-[10px] text-faint">{relTime(n.ts)}</time>
      </span>
    </button>
  );
}

function Chips({ chips, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
      {chips.map((c) => (
        <button
          key={c.id}
          onClick={() => onChange(c.id)}
          className={`press rounded-full border px-2.5 py-1 mono text-[10px] uppercase tracking-[0.06em]
            ${value === c.id ? 'border-[var(--accent)] text-text' : 'border-line-2 text-muted'}`}
        >
          {c.label}{c.n != null ? ` ${c.n}` : ''}
        </button>
      ))}
    </div>
  );
}

function CongressList({ desktop }) {
  const [rows, setRows] = useState(null);
  const [sub, setSub] = useState({ heldOnly: false, type: '', chamber: '' });

  useEffect(() => {
    let alive = true;
    setRows(null);
    const params = { days: 60 };
    if (sub.heldOnly) params.heldOnly = 1;
    if (sub.type) params.type = sub.type;
    if (sub.chamber) params.chamber = sub.chamber;
    getCongress(params)
      .then((r) => alive && setRows(r?.trades || []))
      .catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [sub]);

  const toggle = (k, v) => setSub((s) => ({ ...s, [k]: s[k] === v ? (typeof v === 'boolean' ? false : '') : v }));

  const subChips = [
    { k: 'heldOnly', v: true, label: 'Held' },
    { k: 'type', v: 'buy', label: 'Buys' },
    { k: 'type', v: 'sell', label: 'Sells' },
    { k: 'chamber', v: 'house', label: 'House' },
    { k: 'chamber', v: 'senate', label: 'Senate' },
  ];

  return (
    <div className={desktop ? 'flex-1 overflow-y-auto' : ''}>
      <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
        {subChips.map((c) => {
          const on = sub[c.k] === c.v;
          return (
            <button key={c.label} onClick={() => toggle(c.k, c.v)}
              className={`press rounded-full border px-2.5 py-1 mono text-[10px] uppercase tracking-[0.06em]
                ${on ? 'border-[var(--accent)] text-text' : 'border-line-2 text-muted'}`}>
              {c.label}
            </button>
          );
        })}
      </div>
      {rows == null && <p className="px-4 py-6 mono text-[11px] text-faint">reading the disclosures…</p>}
      {rows?.length === 0 && <p className="px-4 py-6 text-[12px] text-faint">No congressional trades match.</p>}
      <div className="rise-in">
        {rows?.map((t, i) => (
          <a key={i} href={t.url || undefined} target="_blank" rel="noreferrer"
            className="press grid grid-cols-[1fr_auto] items-start gap-3 border-b border-line px-4 py-3 text-left">
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[13px] leading-tight text-text">
                <span className="mono text-[11px] text-faint">{t.ticker || '—'}</span>
                <span className={`mono text-[10px] ${t.type === 'buy' ? 'text-good' : 'text-crit'}`}>{String(t.type || '').toUpperCase()}</span>
                {(t.isHeld ?? t.held) && <Icon name="check" size={11} className="text-muted" />}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-faint">
                {t.member}{t.party ? ` (${t.party})` : ''} · {t.chamber}
              </span>
            </span>
            <span className="text-right mono text-[10px] text-muted">
              <span className="block">{money(t.amountLow)}{t.amountHigh ? `–${money(t.amountHigh)}` : ''}</span>
              <time className="text-faint">{t.txDate || ''}</time>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

function Prefs({ prefs, onSave }) {
  if (!prefs) return <p className="px-4 py-4 mono text-[11px] text-faint">loading preferences…</p>;
  const kinds = prefs.kinds || {};
  const cycle = (k) => onSave({ kinds: { [k]: CYCLE[kinds[k] || 'off'] } });
  const setHour = (k, v) => {
    const h = Math.max(0, Math.min(23, parseInt(v, 10) || 0));
    onSave({ [k]: h });
  };
  return (
    <div className="space-y-4 px-4 py-4">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {PREF_KINDS.map((k) => {
          const st = kinds[k] || 'off';
          return (
            <button key={k} onClick={() => cycle(k)}
              className="press flex items-center justify-between rounded-md border border-line-2 px-2.5 py-1.5">
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <Icon name={KIND_ICON[k]} size={12} /> {KIND_LABEL[k]}
              </span>
              <span className={`rounded-sm border px-1.5 py-0.5 mono text-[9px] uppercase ${STATE_CLS[st]}`}>{st}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3 mono text-[10px] text-muted">
        <span className="label">Quiet hours (ET)</span>
        <input type="number" min="0" max="23" value={prefs.quietStart ?? 22}
          onChange={(e) => setHour('quietStart', e.target.value)}
          className="w-12 rounded-sm border border-line-2 bg-transparent px-1.5 py-1 text-center text-text" />
        <span>to</span>
        <input type="number" min="0" max="23" value={prefs.quietEnd ?? 7}
          onChange={(e) => setHour('quietEnd', e.target.value)}
          className="w-12 rounded-sm border border-line-2 bg-transparent px-1.5 py-1 text-center text-text" />
      </div>
      <p className="text-[10px] leading-snug text-faint">
        Critical alerts always push. Digest items roll into a morning + close summary.
      </p>
    </div>
  );
}

export default function Alerts({ desktop, openId, onRun }) {
  const { items, unread } = useNotifications(60);
  const [filter, setFilter] = useState('all');
  const [selId, setSelId] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [prefs, setPrefs] = useState(null);
  const didDeepLink = useRef(false);

  useEffect(() => {
    let alive = true;
    getNotifyPrefs().then((p) => alive && setPrefs(p)).catch(() => {});
    return () => { alive = false; };
  }, []);

  const savePrefs = (patch) => {
    setPrefs((cur) => {
      const next = { ...cur, ...patch, kinds: { ...(cur?.kinds || {}), ...(patch.kinds || {}) } };
      setNotifyPrefs(patch).catch(() => {});
      return next;
    });
  };

  const openItem = (n) => {
    setSelId(n.id);
    if (!desktop) setSheetOpen(true);
    if (!n.read) markNotificationsRead([n.id]).catch(() => {});
  };

  // deep link
  useEffect(() => {
    if (didDeepLink.current || !openId || !items.length) return;
    const hit = items.find((n) => n.id === openId);
    if (hit) { didDeepLink.current = true; openItem(hit); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, items]);

  const kindsPresent = useMemo(() => {
    const set = new Set(items.map((n) => n.kind));
    return PREF_KINDS.filter((k) => set.has(k));
  }, [items]);

  const chips = useMemo(() => ([
    { id: 'all', label: 'All', n: items.length },
    ...kindsPresent.map((k) => ({ id: k, label: KIND_LABEL[k] || k, n: items.filter((n) => n.kind === k).length })),
    { id: 'congress', label: 'Congress' },
  ]), [items, kindsPresent]);

  const feed = useMemo(() => {
    if (filter === 'all' || filter === 'congress') return items;
    return items.filter((n) => n.kind === filter);
  }, [items, filter]);

  const selected = useMemo(() => items.find((n) => n.id === selId) || null, [items, selId]);
  const congressMode = filter === 'congress';

  const header = (
    <div className="flex items-center justify-between border-b border-line px-4 py-3">
      <div className="flex items-center gap-2">
        <h1 className="mono text-xs tracking-[0.16em] text-text">ALERTS</h1>
        {unread > 0 && <span className="mono text-[10px] text-[var(--accent)]">{unread} new</span>}
      </div>
      <div className="flex items-center gap-2">
        {unread > 0 && (
          <button onClick={() => markNotificationsRead(null).catch(() => {})}
            className="btn-ghost px-2 py-1 text-[10px]">Mark all read</button>
        )}
        <button onClick={() => setShowPrefs((v) => !v)}
          className={`press rounded-md border px-2 py-1 mono text-[10px] ${showPrefs ? 'border-[var(--accent)] text-text' : 'border-line-2 text-muted'}`}>
          <Icon name="sync" size={12} className="mr-1 inline" />Prefs
        </button>
      </div>
    </div>
  );

  const listPane = (
    <div className="flex min-h-0 flex-1 flex-col">
      <Chips chips={chips} value={filter} onChange={(id) => { setFilter(id); setShowPrefs(false); }} />
      {showPrefs && <Prefs prefs={prefs} onSave={savePrefs} />}
      {!showPrefs && congressMode && <CongressList desktop={desktop} />}
      {!showPrefs && !congressMode && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {feed.length === 0 ? (
            <p className="px-4 py-10 text-center text-[12px] leading-relaxed text-faint">
              Nothing on the wire. News, filings, congressional trades and the boss's reads land here.
            </p>
          ) : (
            <div className="rise-in">
              {feed.map((n) => (
                <FeedRow key={n.id} n={n} active={desktop && n.id === selId} onClick={() => openItem(n)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (desktop) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[40%] min-w-[300px] flex-col border-r border-line">
            {listPane}
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
            <AlertDetail item={selected} onRun={onRun} titleId="alert-detail-title" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {header}
      {listPane}
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} labelledBy="alert-detail-title">
        {sheetOpen && <AlertDetail item={selected} onRun={(t) => { setSheetOpen(false); onRun?.(t); }} titleId="alert-detail-title" />}
      </Sheet>
    </div>
  );
}
