import { useEffect, useMemo, useState } from 'react';
import { getQueue, skipQueueItem, approveQueue, getLedger, fillExecution, cancelExecution } from '../api';
import Icon from '../ui/Icon';

const money = (n) => `$${Math.round(Math.abs(n || 0)).toLocaleString()}`;

const ACTION_COLOR = { EXIT: 'var(--crit)', TRIM: 'var(--warn)', ADD: 'var(--good)' };

function relTime(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Card({ item, checked, onToggle, onAdjust, onSkip }) {
  const c = ACTION_COLOR[item.action];
  return (
    <li className="flex items-start gap-3 border-b border-line py-3 last:border-0">
      <button onClick={() => onToggle(item.id)} aria-pressed={checked}
        className={`press mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded border transition-colors
          ${checked ? 'border-transparent bg-lit text-base' : 'border-line-2 text-transparent'}`}>
        <Icon name="check" size={12} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mono text-[11px] font-semibold" style={{ color: c }}>{item.action}</span>
          <span className="mono text-[12px] font-medium text-text">{item.ticker}</span>
          <span className="mono text-[8px] tracking-[0.06em] text-faint">{item.tag}</span>
          {item.stale && <span className="mono text-[8px] text-warn">stale — re-run?</span>}
        </div>
        {item.note && <p className="mt-1 line-clamp-2 max-w-[52ch] text-[11px] leading-snug text-muted">{item.note}</p>}
        <div className="mt-1 mono text-[9px] text-faint">{item.source}{item.ts ? ` · ${relTime(item.ts)}` : ''}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={`mono text-[12px] tabular-nums ${item.cash >= 0 ? 'text-good' : 'text-text'}`}>
          {item.cash >= 0 ? '+' : '−'}{money(item.cash)}
        </span>
        <div className="flex gap-2 mono text-[9px] text-faint">
          {item.editable && <button onClick={() => onAdjust(item)} className="press hover:text-muted">adjust</button>}
          <button onClick={() => onSkip(item)} className="press hover:text-muted">skip</button>
        </div>
      </div>
    </li>
  );
}

function SkipMenu({ item, onPick, onClose }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-end sm:place-items-center bg-black/40" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="panel w-full max-w-xs rounded-t-xl sm:rounded-xl border border-line bg-base-2 p-4">
        <div className="mono text-[10px] text-faint">{item.action} {item.ticker}</div>
        <div className="mt-2 flex flex-col gap-1">
          {[['now', 'Not now — back tomorrow'], ['week', 'Snooze a week'], ['dismiss', "Dismiss — stop suggesting it"]].map(([mode, label]) => (
            <button key={mode} onClick={() => onPick(mode)}
              className="press rounded-md px-2 py-2 text-left text-[12px] text-text hover:bg-line-2/60">{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdjustMenu({ item, onSave, onClose }) {
  const [v, setV] = useState(String(Math.abs(item.cash)));
  return (
    <div className="fixed inset-0 z-40 grid place-items-end sm:place-items-center bg-black/40" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="panel w-full max-w-xs rounded-t-xl sm:rounded-xl border border-line bg-base-2 p-4">
        <div className="mono text-[10px] text-faint">{item.action} {item.ticker} — amount</div>
        <div className="mt-2 flex items-center gap-2">
          <span className="mono text-[13px] text-faint">$</span>
          <input autoFocus type="number" min="0" value={v} onChange={(e) => setV(e.target.value)}
            className="mono w-full rounded-md border border-line-2 bg-base px-2 py-1.5 text-[13px] text-text outline-none focus:border-lit/50" />
        </div>
        <button onClick={() => onSave(Number(v) || 0)} className="btn-accent mt-3 h-8 w-full text-[11px]">save</button>
      </div>
    </div>
  );
}

function BasketSheet({ selected, onClose, onConfirm, busy }) {
  const netFrees = selected.filter((i) => i.cash >= 0).reduce((s, i) => s + i.cash, 0);
  const netCosts = selected.filter((i) => i.cash < 0).reduce((s, i) => s + Math.abs(i.cash), 0);
  const left = netFrees - netCosts;
  return (
    <div className="fixed inset-0 z-40 grid place-items-end sm:place-items-center bg-black/40" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="panel w-full max-w-md rounded-t-xl sm:rounded-xl border border-line bg-base-2 p-5">
        <div className="label">The basket</div>
        <ul className="mt-3 space-y-1.5">
          {selected.map((i) => (
            <li key={i.id} className="flex justify-between mono text-[12px] text-muted">
              <span>{i.action} {i.ticker}</span>
              <span className={i.cash >= 0 ? 'text-good' : 'text-text'}>{i.cash >= 0 ? '+' : '−'}{money(i.cash)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-line pt-2 mono text-[12px] text-text">
          <span>{left >= 0 ? 'Cash left over' : 'Cash needed'}</span>
          <span className={left >= 0 ? 'text-good' : 'text-crit'}>{left >= 0 ? '+' : '−'}{money(left)}</span>
        </div>
        <p className="mt-2 text-[10.5px] leading-snug text-faint">
          This writes tracked intents to the ledger. No orders are placed —
          place the trades yourself, then mark each one filled.
        </p>
        <button disabled={busy} onClick={onConfirm} className="btn-accent mt-4 h-9 w-full text-[11px] disabled:opacity-50">
          {busy ? 'approving…' : `Approve ${selected.length}`}
        </button>
      </div>
    </div>
  );
}

function LedgerRow({ e, onFill, onCancel }) {
  return (
    <li className="flex items-center justify-between py-1.5">
      <span className="mono text-[11px] text-muted">
        <span style={{ color: ACTION_COLOR[e.action] }}>{e.action}</span> {e.ticker}
        {e.status === 'done' && e.fillPrice != null && <span className="text-faint"> · filled ${e.fillPrice}</span>}
      </span>
      {e.status === 'working' ? (
        <span className="flex gap-2 mono text-[9px] text-faint">
          <button onClick={() => onFill(e)} className="press hover:text-good">mark filled</button>
          <button onClick={() => onCancel(e.id)} className="press hover:text-crit">cancel</button>
        </span>
      ) : (
        <span className="mono text-[9px] text-faint">{relTime(e.filledAt)}</span>
      )}
    </li>
  );
}

export default function Queue({ onRun }) {
  const [q, setQ] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [skipItem, setSkipItem] = useState(null);
  const [adjustItem, setAdjustItem] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [showBasket, setShowBasket] = useState(false);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const load = () => {
    getQueue().then(setQ).catch(() => setQ({ ready: false, items: [] }));
    getLedger().then(setLedger).catch(() => setLedger({ working: [], done: [] }));
  };
  useEffect(load, []);

  const items = useMemo(
    () => (q?.items || []).map((i) => (overrides[i.id] != null ? { ...i, cash: i.action === 'ADD' ? -overrides[i.id] : overrides[i.id] } : i)),
    [q, overrides],
  );
  const selected = items.filter((i) => checked.has(i.id));

  const toggle = (id) => setChecked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const doSkip = async (mode) => {
    const it = skipItem;
    setSkipItem(null);
    await skipQueueItem(it.id, mode).catch(() => {});
    setQ((prev) => prev && { ...prev, items: prev.items.filter((x) => x.id !== it.id) });
    setChecked((s) => { const n = new Set(s); n.delete(it.id); return n; });
  };

  const doAdjust = (amount) => {
    setOverrides((o) => ({ ...o, [adjustItem.id]: amount }));
    setAdjustItem(null);
  };

  const doApprove = async () => {
    setBusy(true);
    try {
      await approveQueue(selected);
      setQ((prev) => prev && { ...prev, items: prev.items.filter((x) => !checked.has(x.id)) });
      setChecked(new Set());
      setShowBasket(false);
      getLedger().then(setLedger).catch(() => {});
    } finally { setBusy(false); }
  };

  const doFill = async (e) => {
    const price = window.prompt(`Fill price for ${e.ticker}?`);
    if (price == null) return;
    await fillExecution(e.id, Number(price) || null, null).catch(() => {});
    getLedger().then(setLedger).catch(() => {});
  };
  const doCancel = async (id) => {
    await cancelExecution(id).catch(() => {});
    getLedger().then(setLedger).catch(() => {});
  };

  if (q === null) return null;
  const working = ledger?.working || [];
  const done = (ledger?.done || []).slice(0, 4);

  return (
    <div className="border-b border-line px-6 py-4 sm:px-8">
      <button onClick={() => setCollapsed((c) => !c)} className="flex w-full items-center justify-between">
        <span className="label">
          {items.length ? `The desk wants ${items.length} call${items.length !== 1 ? 's' : ''}` : 'The queue'}
        </span>
        <span className="mono text-[9px] text-faint">{collapsed ? 'show' : 'hide'}</span>
      </button>

      {!collapsed && (
        <>
          {!items.length && (
            <p className="mt-2 text-[11px] text-faint">Nothing to act on. The book is clean.</p>
          )}
          {items.length > 0 && (
            <ul className="mt-1">
              {items.map((i) => (
                <Card key={i.id} item={i} checked={checked.has(i.id)} onToggle={toggle}
                  onAdjust={setAdjustItem} onSkip={setSkipItem} />
              ))}
            </ul>
          )}
          {selected.length > 0 && (
            <div className="mt-2 flex items-center justify-between rounded-lg bg-line-2/40 px-3 py-2">
              <span className="mono text-[11px] text-muted">{selected.length} selected</span>
              <button onClick={() => setShowBasket(true)} className="btn-accent h-7 px-3 text-[10px]">Review basket →</button>
            </div>
          )}
          {(working.length > 0 || done.length > 0) && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="label mb-1">Working & done</div>
              <ul>
                {working.map((e) => <LedgerRow key={e.id} e={e} onFill={doFill} onCancel={doCancel} />)}
                {done.map((e) => <LedgerRow key={e.id} e={e} onFill={doFill} onCancel={doCancel} />)}
              </ul>
            </div>
          )}
        </>
      )}

      {skipItem && <SkipMenu item={skipItem} onPick={doSkip} onClose={() => setSkipItem(null)} />}
      {adjustItem && <AdjustMenu item={adjustItem} onSave={doAdjust} onClose={() => setAdjustItem(null)} />}
      {showBasket && (
        <BasketSheet selected={selected} busy={busy} onClose={() => setShowBasket(false)} onConfirm={doApprove} />
      )}
    </div>
  );
}
