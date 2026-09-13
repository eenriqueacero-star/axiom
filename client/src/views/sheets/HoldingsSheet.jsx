import { useEffect, useMemo, useState } from 'react';
import {
  getLatestAnalysis, setHolding, addTicker, removeTicker,
  createAccount, renameAccount, deleteAccount,
} from '../../api';
import Icon from '../../ui/Icon';
import { stripMd } from '../../components/stance.js';

const V = {
  ADD:  { c: 'var(--good)', bg: 'rgba(75,173,131,0.13)' },
  HOLD: { c: 'var(--muted)', bg: 'rgba(255,255,255,0.04)' },
  TRIM: { c: 'var(--warn)', bg: 'rgba(214,154,62,0.13)' },
  EXIT: { c: 'var(--crit)', bg: 'rgba(224,87,78,0.13)' },
};
const money = (n) => `$${Math.round(n).toLocaleString()}`;

function DecisionDetail({ ticker }) {
  const [a, setA] = useState(undefined);
  useMemo(() => {
    getLatestAnalysis(ticker).then((r) => setA(r?.found ? r.analysis : null)).catch(() => setA(null));
  }, [ticker]);

  if (a === undefined) return <p className="py-2 text-[11px] text-faint">Loading the council's read…</p>;
  if (a === null) return <p className="py-2 text-[11px] text-faint">No council run on {ticker} yet.</p>;

  const c = a.computed || {};
  const econ = a.holdings?.econ;
  const flags = [
    c.broken && 'THESIS BROKEN', c.downtrendExit && 'DOWNTREND',
    c.concentrationTrim && 'OVER CAP', (c.atCap && !c.concentrationTrim) && 'AT CAP',
    c.entryClear === false && 'ENTRY NOT CLEAR',
    c.dataIncomplete && 'LIVE QUOTE DOWN',
  ].filter(Boolean);

  return (
    <div className="space-y-2.5 py-2">
      {a.headline && <p className="text-[12px] text-text leading-snug">{a.headline}</p>}
      {(a.impact || a.rationale) && <p className="text-[11.5px] text-muted leading-relaxed">{a.impact || a.rationale}</p>}
      {econ?.shares != null && (
        <p className="text-[11px] text-muted">
          {econ.shares} sh at ${Number(econ.avgCost || 0).toFixed(2)} avg
          {econ.value != null && ` — ${money(econ.value)}`}
          {econ.unrealPct != null && `, ${econ.unrealPct >= 0 ? 'up' : 'down'} ${Math.abs(econ.unrealPct * 100).toFixed(0)}%`}
        </p>
      )}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {flags.map((f) => <span key={f} className="mono text-[8px] px-1.5 py-0.5 rounded" style={{ color: 'var(--crit)', background: 'rgba(224,87,78,0.12)' }}>{f}</span>)}
        </div>
      )}
      {Array.isArray(a.agents) && (
        <ul className="pt-1 space-y-0.5">
          {a.agents.map((ag) => (
            <li key={ag.id || ag.name} className="text-[10px] text-faint leading-snug">
              <span className="text-muted">{ag.name}</span>{ag.stance ? ` — ${ag.stance}` : ''}{ag.note ? `: ${ag.note}` : ''}
            </li>
          ))}
        </ul>
      )}
      {a.deskNote?.conclusion && (
        <p className="text-[11px] text-faint leading-relaxed border-l-2 border-line pl-2">
          <span className="mono text-[10px] uppercase tracking-wider text-rex/80">
            desk note{a.deskNote.participants?.length ? ` · ${a.deskNote.participants.join(' & ')}` : ''}{' '}
          </span>
          {stripMd(a.deskNote.conclusion)}
        </p>
      )}
    </div>
  );
}

// CONFIRM-tier action: nothing changes until the investor taps Save, and the
// exact diff (old -> new) is on screen before it happens — never a silent edit.
function EditPositionModal({ p, onClose, onSaved }) {
  const [shares, setShares] = useState(String(p.shares ?? ''));
  const [costBasis, setCostBasis] = useState(String(p.costBasis ?? ''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const nShares = Number(shares);
  const nCost = Number(costBasis);
  const validShares = shares.trim() !== '' && Number.isFinite(nShares) && nShares >= 0;
  const validCost = costBasis.trim() === '' || (Number.isFinite(nCost) && nCost >= 0);
  const sharesChanged = validShares && nShares !== (p.shares ?? 0);
  const costChanged = validCost && costBasis.trim() !== '' && nCost !== (p.costBasis ?? 0);
  const canSave = validShares && validCost && (sharesChanged || costChanged) && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setErr('');
    try {
      await setHolding(p.accountId, p.ticker, {
        shares: nShares,
        costBasis: costBasis.trim() === '' ? p.costBasis : nCost,
      });
      onSaved?.();
      onClose();
    } catch (e) {
      setErr(e.message || 'Could not save — try again.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-black/40 sm:place-items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="panel w-full max-w-xs rounded-t-xl border border-line bg-base-2 p-4 sm:rounded-xl">
        <div className="mono text-[11px] text-text">Edit {p.ticker} — {p.account}</div>

        <label className="mt-3 block text-[10px] uppercase tracking-wide text-faint">Shares</label>
        <input value={shares} onChange={(e) => setShares(e.target.value)} inputMode="decimal"
          className="mono mt-1 w-full rounded-md border border-line-2 bg-base px-2.5 py-1.5 text-[13px] text-text" />

        <label className="mt-3 block text-[10px] uppercase tracking-wide text-faint">Cost basis (avg $/sh)</label>
        <input value={costBasis} onChange={(e) => setCostBasis(e.target.value)} inputMode="decimal"
          className="mono mt-1 w-full rounded-md border border-line-2 bg-base px-2.5 py-1.5 text-[13px] text-text" />

        {(sharesChanged || costChanged) && (
          <div className="mt-3 rounded-md bg-panel-2 p-2.5 text-[11px] leading-relaxed text-muted">
            {sharesChanged && <p>Shares: {p.shares ?? 0} → <span className="text-text">{nShares}</span></p>}
            {costChanged && <p>Cost basis: ${Number(p.costBasis ?? 0).toFixed(2)} → <span className="text-text">${nCost.toFixed(2)}</span></p>}
          </div>
        )}
        {err && <p className="mt-2 text-[11px] text-crit">{err}</p>}

        <div className="mt-4 flex gap-2">
          <button onClick={onClose} disabled={busy}
            className="press flex-1 rounded-md border border-line-2 py-2 text-[12px] text-muted hover:text-text">
            Cancel
          </button>
          <button onClick={save} disabled={!canSave}
            className="press flex-1 rounded-md bg-accent py-2 text-[12px] font-medium text-base disabled:opacity-40">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function HoldingsSheet({ pf, diag, stances, onAnalyze, onChanged }) {
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [addTk, setAddTk] = useState('');
  const [addAcct, setAddAcct] = useState('');
  const [addErr, setAddErr] = useState('');
  const [newAcctName, setNewAcctName] = useState('');
  const [renamingAcct, setRenamingAcct] = useState(null);
  const [acctNameDraft, setAcctNameDraft] = useState('');
  const [deletingAcct, setDeletingAcct] = useState(null);
  const rows = useMemo(() => {
    const out = [];
    for (const acct of pf?.accounts || []) {
      for (const p of acct.positions || []) {
        if (!p.ticker) continue;
        // A broker sync reporting 0 shares means "sold out" — skip it. But a
        // manually-tracked position freshly added via "add a ticker" also
        // starts at 0 shares, and needs to stay visible so it can be edited.
        if (acct.linked && (p.shares || 0) <= 0) continue;
        out.push({ ...p, account: acct.label, accountId: acct.id, linked: !!acct.linked });
      }
    }
    return out.sort((x, y) => (y.value || 0) - (x.value || 0));
  }, [pf]);

  const unlinkedAccounts = useMemo(
    () => (pf?.accounts || []).filter((a) => !a.linked),
    [pf],
  );

  useEffect(() => {
    if (unlinkedAccounts.length === 1 && addAcct !== unlinkedAccounts[0].id) {
      setAddAcct(unlinkedAccounts[0].id);
    }
  }, [unlinkedAccounts, addAcct]);

  const total = pf?.totals?.value || diag?.total || 1;
  const st = stances?.stances || {};

  const confirmRemove = async (p) => {
    setBusy(true);
    try {
      await removeTicker(p.accountId, p.ticker);
      setRemoving(null);
      setOpen(null);
      onChanged?.();
    } catch { /* leave the confirm open so the investor can retry */ }
    finally { setBusy(false); }
  };

  const submitAdd = async () => {
    const t = addTk.toUpperCase().trim();
    if (!/^[A-Z.\-]{1,10}$/.test(t)) { setAddErr('Enter a valid ticker.'); return; }
    if (!addAcct) { setAddErr('Pick an account.'); return; }
    setBusy(true);
    setAddErr('');
    try {
      await addTicker(addAcct, t);
      setAddTk('');
      onChanged?.();
    } catch (e) {
      setAddErr(e.message || 'Could not add — try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitNewAccount = async () => {
    setBusy(true);
    try {
      await createAccount(newAcctName.trim() || 'New account');
      setNewAcctName('');
      onChanged?.();
    } catch { /* leave the input as-is so the investor can retry */ }
    finally { setBusy(false); }
  };

  const submitRename = async (acctId) => {
    setBusy(true);
    try {
      await renameAccount(acctId, acctNameDraft);
      setRenamingAcct(null);
      onChanged?.();
    } catch { /* leave rename open so the investor can retry */ }
    finally { setBusy(false); }
  };

  const confirmDeleteAccount = async (acctId) => {
    setBusy(true);
    try {
      await deleteAccount(acctId);
      setDeletingAcct(null);
      onChanged?.();
    } catch { /* leave the confirm open so the investor can retry */ }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <h2 id="sheet-holdings-title" className="mono text-xs tracking-[0.14em] text-text">THE BOOK</h2>
        <span className="mono text-[10px] text-faint">{rows.length} names</span>
      </div>
      {diag?.sleeve && (
        <p className="text-[11px] text-muted pb-2">
          Core {Math.round(diag.sleeve.corePct * 100)}% / Satellite {Math.round(diag.sleeve.satellitePct * 100)}% —
          target {Math.round((diag.sleeve.targetCore || 0.5) * 100)} / {Math.round((1 - (diag.sleeve.targetCore || 0.5)) * 100)}.
        </p>
      )}

      <ul className="divide-y divide-line">
        {rows.map((p) => {
          const s = st[p.ticker];
          const v = s && V[s.verdict];
          const w = (p.value || 0) / total;
          const isOpen = open === p.ticker;
          return (
            <li key={p.ticker + p.account}>
              <button onClick={() => setOpen(isOpen ? null : p.ticker)}
                className="grid w-full grid-cols-[52px_1fr_auto_auto] items-center gap-2.5 py-2.5 text-left">
                <span className="mono text-[12px] font-medium text-text">{p.ticker}</span>
                <span className="h-[3px] rounded-sm bg-line-2 relative overflow-hidden">
                  <i className="absolute inset-y-0 left-0 bg-muted" style={{ width: `${Math.min(100, w / 0.4 * 100)}%` }} />
                </span>
                <span className="mono text-[11px] text-muted tabular-nums">{money(p.value || 0)}</span>
                {v ? (
                  <span className="mono text-[8px] px-1.5 py-0.5 rounded" style={{ color: v.c, background: v.bg }}>{s.verdict}</span>
                ) : <span className="mono text-[8px] text-faint">—</span>}
              </button>
              {isOpen && <DecisionDetail ticker={p.ticker} />}
              {isOpen && (
                <div className="flex gap-3 pb-2">
                  <button onClick={() => onAnalyze?.(p.ticker)} className="mono text-[10px] text-rex">
                    run the council →
                  </button>
                  {p.linked ? (
                    <span className="mono text-[10px] text-faint" title="Synced from your broker — edit it there, not here">
                      synced from {p.account}
                    </span>
                  ) : (
                    <>
                      <button onClick={() => setEditing(p)} className="mono text-[10px] text-faint hover:text-text">
                        edit shares / cost
                      </button>
                      {removing === p.ticker + p.accountId ? (
                        <span className="mono text-[10px] text-faint">
                          remove {p.ticker}?{' '}
                          <button onClick={() => confirmRemove(p)} disabled={busy} className="text-crit hover:underline">
                            yes
                          </button>{' '}
                          <button onClick={() => setRemoving(null)} className="hover:underline">no</button>
                        </span>
                      ) : (
                        <button onClick={() => setRemoving(p.ticker + p.accountId)} className="mono text-[10px] text-faint hover:text-crit">
                          remove
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {unlinkedAccounts.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 pt-3">
          <input
            value={addTk}
            onChange={(e) => setAddTk(e.target.value)}
            placeholder="add a ticker"
            className="mono w-24 rounded-md border border-line-2 bg-base px-2 py-1 text-[11px] uppercase text-text"
          />
          {unlinkedAccounts.length > 1 ? (
            <select
              value={addAcct}
              onChange={(e) => setAddAcct(e.target.value)}
              className="mono rounded-md border border-line-2 bg-base px-2 py-1 text-[11px] text-text"
            >
              <option value="">to account…</option>
              {unlinkedAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          ) : null}
          <button onClick={submitAdd} disabled={busy || !addTk.trim()}
            className="press mono text-[11px] text-faint hover:text-text disabled:opacity-40">
            add →
          </button>
          {addErr && <span className="text-[11px] text-crit">{addErr}</span>}
        </div>
      ) : null}

      {unlinkedAccounts.length > 0 && (
        <ul className="space-y-1 pt-2">
          {unlinkedAccounts.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              {renamingAcct === a.id ? (
                <>
                  <input
                    value={acctNameDraft}
                    onChange={(e) => setAcctNameDraft(e.target.value)}
                    autoFocus
                    className="mono w-32 rounded-md border border-line-2 bg-base px-2 py-1 text-[11px] text-text"
                  />
                  <button onClick={() => submitRename(a.id)} disabled={busy} className="mono text-[10px] text-faint hover:text-text">save</button>
                  <button onClick={() => setRenamingAcct(null)} className="mono text-[10px] text-faint hover:text-text">cancel</button>
                </>
              ) : deletingAcct === a.id ? (
                <span className="mono text-[10px] text-faint">
                  delete {a.label}? all its manual positions go with it —{' '}
                  <button onClick={() => confirmDeleteAccount(a.id)} disabled={busy} className="text-crit hover:underline">yes</button>{' '}
                  <button onClick={() => setDeletingAcct(null)} className="hover:underline">no</button>
                </span>
              ) : (
                <>
                  <span className="mono text-[11px] text-faint">{a.label}</span>
                  <button onClick={() => { setRenamingAcct(a.id); setAcctNameDraft(a.label); }}
                    className="mono text-[10px] text-faint hover:text-text">rename</button>
                  <button onClick={() => setDeletingAcct(a.id)}
                    className="mono text-[10px] text-faint hover:text-crit">delete</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 pt-2">
        <input
          value={newAcctName}
          onChange={(e) => setNewAcctName(e.target.value)}
          placeholder="new account name"
          className="mono w-40 rounded-md border border-line-2 bg-base px-2 py-1 text-[11px] text-text"
        />
        <button onClick={submitNewAccount} disabled={busy}
          className="press mono text-[11px] text-faint hover:text-text disabled:opacity-40">
          + account
        </button>
      </div>

      {editing && (
        <EditPositionModal p={editing} onClose={() => setEditing(null)} onSaved={onChanged} />
      )}
    </div>
  );
}
