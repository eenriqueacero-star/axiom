import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getContributions, setContributions, addContributionEntry, removeContributionEntry,
  getBrokerStatus, syncBroker,
  getNotifyPrefs, setNotifyPrefs, sendTestPush,
  getHealth, getKeyStatus, getJobs,
  getBacktest, getQuantStatus,
} from '../api';
import { useAuth } from '../AuthProvider';
import { pushState, enablePush, disablePush } from '../lib/push';
import Icon from '../ui/Icon';

/* ---------- helpers ---------- */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const money = (n) => `$${Math.abs(Math.round(Number(n) || 0)).toLocaleString()}`;
const pct = (n) => `${(Number(n) * 100).toFixed(1)}%`;
const signedPct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(Number(n) * 100).toFixed(1)}%`;

function relTime(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function cadence(ms) {
  if (!ms) return '';
  const h = ms / 3_600_000;
  if (h >= 24) return `~${Math.round(h / 24)}d`;
  if (h >= 1) return `${Math.round(h)}h`;
  return `${Math.round(ms / 60_000)}m`;
}

const JOB_DOT = { ok: 'bg-good', failing: 'bg-crit', overdue: 'bg-warn', pending: 'bg-faint' };
const KEY_KINDS = ['news', 'filing', 'insider', 'congress', 'move', 'rating', 'scout', 'desk', 'opportunity', 'macro'];
const KIND_LABEL = {
  news: 'News', filing: 'Filings', insider: 'Insider buys', congress: 'Congress trades',
  move: 'Big moves', rating: 'Rating changes', scout: 'Scout re-rates', desk: 'Desk notes',
  opportunity: 'Opportunities', macro: 'Macro calendar',
};
const NP_NEXT = { push: 'digest', digest: 'off', off: 'push' };
const NP_TONE = { push: 'text-good border-good/40', digest: 'text-warn border-warn/40', off: 'text-faint border-line-2' };

function Dot({ ok, className = '' }) {
  return <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${ok ? 'bg-good' : 'bg-crit'} ${className}`} />;
}

function Section({ id, title, icon, children, refCb }) {
  return (
    <section ref={refCb} id={`you-${id}`} className="rise-in panel rounded-xl p-5">
      <h2 className="label mb-4 flex items-center gap-2">
        <Icon name={icon} size={13} className="text-muted" /> {title}
      </h2>
      {children}
    </section>
  );
}

const Field = ({ label, children }) => (
  <label className="flex flex-col gap-1">
    <span className="label text-[9px]">{label}</span>
    {children}
  </label>
);

const inputCls =
  'w-full rounded-md border border-line-2 bg-base-2 px-2.5 py-1.5 mono text-xs text-text ' +
  'outline-none focus:border-faint';

/* ---------- 1. Account ---------- */

function AccountSection() {
  const { user, signOut } = useAuth();
  return (
    <Section id="account" title="Account" icon="you">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="mono text-sm text-text">{user?.email || '—'}</div>
          <div className="label mt-1 text-[9px]">Signed in</div>
        </div>
        {user?.dev ? (
          <span className="rounded-md border border-line-2 px-2.5 py-1 mono text-[10px] text-warn">dev mode</span>
        ) : (
          <button onClick={signOut} className="btn-ghost press px-3 py-1.5">Sign out</button>
        )}
      </div>
    </Section>
  );
}

/* ---------- 2. Contributions ---------- */

function ContributionsSection() {
  const [c, setC] = useState(null);
  const [weekly, setWeekly] = useState('');
  const [weekday, setWeekday] = useState(1);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), amount: '', direction: 'in' });
  const [busy, setBusy] = useState(false);

  const load = () => getContributions().then((d) => {
    setC(d);
    setWeekly(d.weeklyAmount ? String(d.weeklyAmount) : '');
    setWeekday(d.weekday ?? 1);
  }).catch(() => setC({ weeklyAmount: 0, weekday: 1, split: [], entries: [] }));
  useEffect(() => { load(); }, []);

  const saveCadence = async () => {
    setBusy(true);
    try { setC(await setContributions({ weeklyAmount: Number(weekly) || 0, weekday: Number(weekday) })); }
    finally { setBusy(false); }
  };

  const addEntry = async (e) => {
    e.preventDefault();
    if (!(Number(form.amount) > 0)) return;
    setBusy(true);
    try {
      setC(await addContributionEntry({
        date: form.date, amount: Number(form.amount), direction: form.direction, note: '',
      }));
      setForm((f) => ({ ...f, amount: '' }));
    } finally { setBusy(false); }
  };

  const remove = async (id) => { setBusy(true); try { setC(await removeContributionEntry(id)); } finally { setBusy(false); } };

  if (!c) return <Section id="contributions" title="Contributions" icon="coin"><p className="mono text-[11px] text-faint">…</p></Section>;

  const dirty = String(c.weeklyAmount || '') !== (weekly || '') || (c.weekday ?? 1) !== Number(weekday);
  const nothingSet = !c.weeklyAmount && !c.entries.length;
  const entries = [...c.entries].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Section id="contributions" title="Contributions" icon="coin">
      {nothingSet && (
        <p className="mb-4 text-[12px] leading-relaxed text-muted">
          No recurring contribution set — the desk assumes there's no new cash coming in.
          Set your weekly number and the DCA engine plans real dollars.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Weekly amount">
          <div className="flex items-center gap-1">
            <span className="mono text-xs text-faint">$</span>
            <input className={inputCls} inputMode="numeric" value={weekly}
              onChange={(e) => setWeekly(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" />
          </div>
        </Field>
        <Field label="Lands on">
          <select className={inputCls} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </Field>
      </div>
      {dirty && (
        <button onClick={saveCadence} disabled={busy} className="btn-accent press mt-3 px-3 py-1.5">Save cadence</button>
      )}

      <div className="mt-5 label text-[9px]">One-off deposits &amp; withdrawals</div>
      <form onSubmit={addEntry} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="date" className={`${inputCls} w-[9.5rem]`} value={form.date}
          onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
        <input className={`${inputCls} w-24`} inputMode="numeric" placeholder="$ amount" value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^0-9.]/g, '') }))} />
        <select className={`${inputCls} w-20`} value={form.direction}
          onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))}>
          <option value="in">In</option>
          <option value="out">Out</option>
        </select>
        <button className="btn-ghost press px-3 py-1.5" disabled={busy}>Add</button>
      </form>

      {entries.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {entries.map((e) => (
            <li key={e.id} className="press flex items-center justify-between rounded-md px-2 py-1.5 text-xs">
              <span className="flex items-center gap-2">
                <Icon name={e.direction === 'out' ? 'trim' : 'add'} size={12}
                  className={e.direction === 'out' ? 'text-crit' : 'text-good'} />
                <span className="mono text-text">{e.direction === 'out' ? '−' : '+'}{money(e.amount)}</span>
                <span className="mono text-[10px] text-faint">{e.date}</span>
                {e.note && <span className="text-[11px] text-muted">{e.note}</span>}
              </span>
              <button onClick={() => remove(e.id)} className="text-faint hover:text-crit" aria-label="Remove">
                <Icon name="close" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* ---------- 3. Broker ---------- */

function BrokerSection() {
  const [s, setS] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { getBrokerStatus().then(setS).catch(() => setS({ configured: false, connections: 0, linkedAccounts: [] })); }, []);

  const sync = async () => {
    setSyncing(true); setMsg('');
    try {
      const r = await syncBroker();
      setMsg(`Synced ${r.synced ?? 0} account${r.synced === 1 ? '' : 's'}.`);
      setS(await getBrokerStatus());
    } catch (e) { setMsg(e.message || 'Sync failed.'); }
    finally { setSyncing(false); }
  };

  const linked = s?.linkedAccounts || [];
  const connected = (s?.connections || 0) > 0 || linked.length > 0;
  const lastSync = linked.reduce((m, a) => Math.max(m, a.syncedAt || 0), 0);

  return (
    <Section id="broker" title="Broker" icon="sync">
      {!s ? (
        <p className="mono text-[11px] text-faint">…</p>
      ) : !s.configured ? (
        <p className="text-[12px] leading-relaxed text-muted">
          Broker linking isn't configured on this deployment. Holdings stay manual.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 mono text-xs">
              <Dot ok={connected} />
              {connected
                ? `${s.connections || linked.length} connection${(s.connections || linked.length) === 1 ? '' : 's'}`
                : 'No brokerage linked'}
            </span>
            <button onClick={sync} disabled={syncing} className="btn-ghost press flex items-center gap-1.5 px-3 py-1.5">
              <Icon name="sync" size={12} className={syncing ? 'animate-spin' : ''} /> Sync now
            </button>
          </div>

          {linked.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5">
              {linked.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded-md border border-line px-2.5 py-1.5 text-xs">
                  <span><span className="mono text-text">{a.label || 'Brokerage'}</span>
                    {a.sub && <span className="ml-2 text-[11px] text-faint">{a.sub}</span>}</span>
                  <span className="mono text-[10px] text-faint">{relTime(a.syncedAt)}</span>
                </li>
              ))}
            </ul>
          )}

          {lastSync > 0 && <p className="mt-2 mono text-[10px] text-faint">Last sync {relTime(lastSync)}</p>}
          {msg && <p className="mt-2 mono text-[11px] text-muted">{msg}</p>}
          <a href="https://dashboard.snaptrade.com/home" target="_blank" rel="noreferrer"
            style={{ color: 'var(--accent)' }}
            className="mt-3 inline-flex items-center gap-1.5 mono text-[11px] hover:underline">
            Connect a brokerage at SnapTrade <Icon name="chevron" size={11} />
          </a>
        </>
      )}
    </Section>
  );
}

/* ---------- 4. Notifications ---------- */

function NotificationsSection() {
  const [prefs, setPrefs] = useState(null);
  const [push, setPush] = useState('off');
  const [testMsg, setTestMsg] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    getNotifyPrefs().then(setPrefs).catch(() => setPrefs(null));
    pushState().then(setPush);
  }, []);

  const patch = async (p) => {
    const next = { ...prefs, ...p, kinds: { ...prefs.kinds, ...(p.kinds || {}) } };
    setPrefs(next);
    try { setPrefs(await setNotifyPrefs(p)); } catch { /* keep optimistic */ }
  };

  const cycleKind = (k) => patch({ kinds: { [k]: NP_NEXT[prefs.kinds[k] || 'off'] } });

  const togglePush = async () => {
    setPending(true);
    try { setPush(push === 'on' ? await disablePush() : await enablePush()); }
    finally { setPending(false); }
  };

  const test = async () => {
    setTestMsg('sending…');
    try { const r = await sendTestPush(); setTestMsg(`Sent to ${r.sent} device${r.sent === 1 ? '' : 's'}.`); }
    catch (e) { setTestMsg(e.message || 'failed'); }
  };

  return (
    <Section id="notifications" title="Notifications" icon="alerts">
      {/* this device */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <div className="mono text-xs text-text">
            This device: {push === 'on' ? 'push on' : push === 'denied' ? 'blocked in browser'
              : push === 'unsupported' ? 'not supported' : 'push off'}
          </div>
          <div className="label mt-1 text-[9px]">Web push</div>
        </div>
        <div className="flex items-center gap-2">
          {(push === 'on' || push === 'off') && (
            <button onClick={togglePush} disabled={pending} className="btn-ghost press px-3 py-1.5">
              {push === 'on' ? 'Turn off' : 'Turn on'}
            </button>
          )}
          {push === 'on' && <button onClick={test} className="btn-ghost press px-3 py-1.5">Send a test</button>}
        </div>
      </div>
      {testMsg && <p className="mt-2 mono text-[11px] text-muted">{testMsg}</p>}

      {!prefs ? (
        <p className="mt-4 mono text-[11px] text-faint">…</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {KEY_KINDS.map((k) => {
              const v = prefs.kinds[k] || 'off';
              return (
                <button key={k} onClick={() => cycleKind(k)}
                  className="press flex items-center justify-between rounded-md px-2.5 py-1.5 text-left">
                  <span className="flex items-center gap-2 text-xs text-text">
                    <Icon name={k} size={13} className="text-muted" /> {KIND_LABEL[k]}
                  </span>
                  <span className={`rounded border px-1.5 py-0.5 mono text-[9px] uppercase tracking-[0.1em] ${NP_TONE[v]}`}>{v}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-end gap-3">
            <Field label="Quiet from (ET)">
              <input className={`${inputCls} w-16`} inputMode="numeric" value={prefs.quietStart}
                onChange={(e) => patch({ quietStart: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })} />
            </Field>
            <Field label="Quiet to (ET)">
              <input className={`${inputCls} w-16`} inputMode="numeric" value={prefs.quietEnd}
                onChange={(e) => patch({ quietEnd: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })} />
            </Field>
          </div>
          <p className="mt-3 text-[11px] text-faint">Critical alerts always push regardless.</p>
        </>
      )}
    </Section>
  );
}

/* ---------- 5. System ---------- */

function SystemSection() {
  const [health, setHealth] = useState(null);
  const [keys, setKeys] = useState(null);
  const [jobs, setJobs] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      getHealth().then((h) => alive && setHealth(h)).catch(() => {});
      getKeyStatus().then((k) => alive && setKeys(k)).catch(() => {});
      getJobs().then((j) => alive && setJobs(j)).catch(() => {});
    };
    load();
    const id = setInterval(load, 60000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const jobLine = jobs?.healthy
    ? 'All jobs running in order'
    : jobs
      ? `${jobs.failing.length} failing · ${jobs.overdue.length} overdue`
      : '';

  return (
    <Section id="system" title="System" icon="spark">
      {/* service dots */}
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {health ? ['firebase', 'push', 'groq', 'broker'].map((k) => (
          <span key={k} className="flex items-center gap-1.5 mono text-[11px] text-muted">
            <Dot ok={!!health[k]} /> {k}
          </span>
        )) : <span className="mono text-[11px] text-faint">…</span>}
      </div>

      {/* keys */}
      {keys && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-x-4 gap-y-1 mono text-[11px] text-muted">
            <span>Groq <span className="text-text">{keys.live}/{keys.total}</span></span>
            <span>NVIDIA <span className="text-text">{keys.nvidiaLive}/{keys.nvidiaTotal}</span></span>
            <span>synth <span className="text-text">{keys.synthProvider}</span></span>
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {keys.keys?.map((key) => (
              <li key={`${key.provider}-${key.index}`} className="flex items-center gap-2 mono text-[10px]">
                <Dot ok={key.ok} />
                <span className="w-24 truncate text-muted">{key.name}</span>
                <span className={key.ok ? 'text-faint' : 'text-crit'}>
                  {key.ok ? `${key.ms}ms` : (key.error || `HTTP ${key.status}`)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* jobs */}
      {jobs && (
        <div className="mt-5">
          <div className={`label mb-2 text-[9px] ${jobs.healthy ? '' : 'text-warn'}`}>Scheduled jobs — {jobLine}</div>
          <ul className="flex flex-col gap-1.5">
            {jobs.jobs.map((j) => (
              <li key={j.name} className="grid grid-cols-[10px_1fr_auto] items-baseline gap-2 text-[11px]">
                <i className={`mt-1 h-1.5 w-1.5 rounded-full ${JOB_DOT[j.status] || 'bg-faint'}`} />
                <span className="min-w-0">
                  <span className="text-text">{j.label}</span>
                  <span className="mono ml-2 text-[9px] text-faint">
                    {cadence(j.everyMs)}{j.window && j.window !== 'always' ? ` · ${j.window}` : ''}
                  </span>
                  {j.status === 'failing' && j.error && (
                    <span className="mono block text-[10px] text-crit">{j.error}</span>
                  )}
                </span>
                <time className="mono text-[9px] text-faint">{relTime(j.lastRunAt)}</time>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

/* ---------- 6. Performance ---------- */

function PerformanceSection() {
  const [bt, setBt] = useState(null);
  const [qs, setQs] = useState(null);
  const [off, setOff] = useState(false);

  useEffect(() => {
    getQuantStatus().then(setQs).catch(() => setQs(null));
    getBacktest().then(setBt).catch(() => setOff(true));
  }, []);

  const rows = bt?.rows || [];
  const holdsNow = bt?.rulesHoldNow?.weights ? Object.keys(bt.rulesHoldNow.weights) : (bt?.holdsNow || []);
  const serviceOff = off || qs?.configured === false;

  return (
    <Section id="performance" title="Performance" icon="trend">
      {serviceOff && !rows.length ? (
        <p className="text-[12px] text-faint">Backtest service is offline.</p>
      ) : !bt ? (
        <p className="mono text-[11px] text-faint">…</p>
      ) : (
        <>
          <p className="mb-3 text-[11px] leading-relaxed text-muted">
            The mechanical rulebook vs the index — rules only, no council judgement.
            {bt.years ? ` ${bt.years} years` : ''}{bt.generatedAt ? ` · as of ${bt.generatedAt}` : ''}.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full mono text-[11px]">
              <thead>
                <tr className="label text-[9px] text-left">
                  <th className="pb-1.5 font-normal">Strategy</th>
                  <th className="pb-1.5 text-right font-normal">CAGR</th>
                  <th className="pb-1.5 text-right font-normal">vs QQQ</th>
                  <th className="pb-1.5 text-right font-normal">Max DD</th>
                  <th className="pb-1.5 text-right font-normal">Sharpe</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const vs = r.vs_qqq_cagr ?? r.vsQQQ;
                  return (
                    <tr key={r.strategy} className="border-t border-line">
                      <td className="py-1.5 pr-2 text-text">{r.strategy}</td>
                      <td className="py-1.5 text-right text-muted">{pct(r.cagr)}</td>
                      <td className={`py-1.5 text-right ${vs == null ? 'text-faint' : vs >= 0 ? 'text-good' : 'text-crit'}`}>
                        {vs == null ? '—' : signedPct(vs)}
                      </td>
                      <td className="py-1.5 text-right text-muted">{pct(r.max_drawdown ?? r.maxDD)}</td>
                      <td className="py-1.5 text-right text-muted">{(r.sharpe ?? 0).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {holdsNow.length > 0 && (
            <div className="mt-4">
              <div className="label mb-2 text-[9px]">
                What the rules would hold now{bt.rulesHoldNow?.asOf ? ` · ${bt.rulesHoldNow.asOf}` : ''}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {holdsNow.map((t) => (
                  <span key={t} className="rounded border border-line-2 px-1.5 py-0.5 mono text-[10px] text-muted">{t}</span>
                ))}
              </div>
            </div>
          )}

          {bt.verdict && <p className="mt-4 text-[11px] leading-relaxed text-muted">{bt.verdict}</p>}
          {qs?.static && <p className="mt-2 mono text-[10px] text-faint">Static snapshot — live re-runs off.</p>}
        </>
      )}
    </Section>
  );
}

/* ---------- shell ---------- */

const NAV = [
  ['account', 'Account', 'you'],
  ['contributions', 'Contributions', 'coin'],
  ['broker', 'Broker', 'sync'],
  ['notifications', 'Notifications', 'alerts'],
  ['system', 'System', 'spark'],
  ['performance', 'Performance', 'trend'],
];

export default function You({ desktop }) {
  const [active, setActive] = useState('account');
  const scrollRef = useRef(null);

  const sections = (
    <>
      <AccountSection />
      <ContributionsSection />
      <BrokerSection />
      <NotificationsSection />
      <SystemSection />
      <PerformanceSection />
    </>
  );

  useEffect(() => {
    if (!desktop) return;
    const root = scrollRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (ents) => {
        const vis = ents.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (vis[0]) setActive(vis[0].target.id.replace('you-', ''));
      },
      { root, rootMargin: '-10% 0px -70% 0px', threshold: [0, 0.5, 1] },
    );
    root.querySelectorAll('section[id^="you-"]').forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, [desktop]);

  const jump = (id) => {
    scrollRef.current?.querySelector(`#you-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  if (desktop) {
    return (
      <div className="flex h-full">
        <nav className="w-[184px] shrink-0 border-r border-line px-3 py-6">
          <div className="label mb-3 px-2">You</div>
          {NAV.map(([id, label, icon]) => (
            <button key={id} onClick={() => jump(id)}
              className={`press flex w-full items-center gap-2 rounded-md px-2 py-2 text-left mono text-[11px] ${
                active === id ? 'text-text' : 'text-faint hover:text-muted'}`}>
              <Icon name={icon} size={13} style={active === id ? { color: 'var(--accent)' } : undefined} /> {label}
            </button>
          ))}
        </nav>
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto grid max-w-[900px] grid-cols-1 gap-4 p-6 lg:grid-cols-2 lg:items-start">
            {sections}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 p-4">{sections}</div>
      </div>
    </div>
  );
}
